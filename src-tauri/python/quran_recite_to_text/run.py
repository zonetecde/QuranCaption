"""
run.py

Main execution pipeline for the Quranic Auto-Segmenter.
This script coordinates a 5-phase pipeline to align audio to Uthmani Quranic text:
1. Silence-based Chunking (Pydub)
2. Acoustic Transcription & Feature Extraction (ONNX FastConformer)
3. Offline Text Search & Auto-Surah Detection (QuranDB)
4. CTC Trellis Forced Alignment & Levenshtein Mapping
5. JSON Export & Audio Slicing

Usage:
    python /run.py [audio_file] [--split] 
"""

import os
import multiprocessing

# --- STRICT CPU USAGE CAP (70%) ---
# Prevent NumPy/OpenBLAS from aggressively spawning 100% CPU threads
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"

import sys
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# --- STARTUP CHECK ---
def check_startup():
    import subprocess
    import urllib.request
    from pathlib import Path
    
    print("\n[Startup] Checking dependencies...")
    req_file = Path(__file__).resolve().parent / "requirements.txt"
    if req_file.exists():
        try:
            import numpy
            import tqdm
            import Levenshtein
            import onnxruntime
            import pydub
            import numba
            print("[Startup] All dependencies are installed.")
        except ImportError:
            print("[Startup] Missing dependencies detected! Installing from requirements.txt...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_file)])
            print("[Startup] Dependencies installed successfully! Restarting pipeline...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
            
    print("[Startup] Checking ONNX model...")
    project_root = Path(__file__).resolve().parent
    onnx_model_path = project_root  / "data" / "model.onnx"
    if not onnx_model_path.exists():
        print(f"[Startup] Model not found at {onnx_model_path}. Starting download...")
        onnx_model_path.parent.mkdir(parents=True, exist_ok=True)
        
        last_percent = -1
        def reporthook(blocknum, blocksize, totalsize):
            nonlocal last_percent
            readsofar = blocknum * blocksize
            if totalsize > 0:
                percent = int(readsofar * 100 / totalsize)
                if percent > last_percent and percent <= 100:
                    print(f"DOWNLOAD_PROGRESS: {percent}%", end="\r")
                    sys.stdout.flush()
                    last_percent = percent
                    
        urllib.request.urlretrieve("https://github.com/yazinsai/offline-tarteel/releases/download/v0.1.0/fastconformer_ar_ctc_q8.onnx", str(onnx_model_path), reporthook)
        print("\n[Startup] Model downloaded successfully!")

check_startup()
# ---------------------
import json
import argparse
import numpy as np
from pathlib import Path
from tqdm import tqdm
from Levenshtein import ratio

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

# --- NEW ONNX DEPENDENCIES ---
import onnxruntime as ort
from QuranKarim.audio_features import LogMelExtractor, load_wav_mono_16k
# -----------------------------

# Local pure files
from QuranKarim.quran_db import QuranDB
from QuranKarim.aligner import ctc_forced_align
from QuranKarim.decoder import CTCDecoder
from QuranKarim.normalizer import normalize_arabic

# ----------------------------------------------------
# COMMAND LINE SETUP
# ----------------------------------------------------
parser = argparse.ArgumentParser(description="The Great Quran")
parser.add_argument("audio_file", nargs='?', help="Path to audio file.")
parser.add_argument("--split", action="store_true", help="Split MP3s per Ayah")
parser.add_argument("--multiple", action="store_true", help="Enable dynamic re-anchoring to support multiple Surahs in one audio file")
parser.add_argument("--fast", action="store_true", help="Unlock 100% hardware speed. If not set, strictly caps at 50% CPU usage.")
parser.add_argument("--letter", action="store_true", help="Generate letter-level timestamps in the final JSON")
args = parser.parse_args()
audio_file = args.audio_file

if not os.path.exists(audio_file):
    print(f"Error: Could not find '{audio_file}'.")
    sys.exit(1)

# ----------------------------------------------------
# INITIALIZATION
# ----------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
onnx_model_path = str(PROJECT_ROOT  / "data" / "model.onnx")


# 1. Load Vocab and init Decoder
vocab_path = str(PROJECT_ROOT  / "data" / "vocab.json")
with open(vocab_path, "r", encoding="utf-8") as f:
    vocab_data = json.load(f)
ctc_decoder = CTCDecoder(vocab_data)
blank_id = ctc_decoder.blank_id

# 2. Load ONNX Session
import multiprocessing
import concurrent.futures

sess_options = ort.SessionOptions()
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

# Disable memory pattern which causes bloat on DirectML dynamic axes
sess_options.enable_mem_pattern = False
sess_options.enable_cpu_mem_arena = False
sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

print(f"Hardware Acceleration: CPU strictly (Fast Mode: {args.fast})")
sess_options.intra_op_num_threads = 1
sess_options.inter_op_num_threads = 1

if args.fast:
    max_workers = multiprocessing.cpu_count()
else:
    # 50% of logical CPU cores to prevent overheating
    max_workers = max(1, int(multiprocessing.cpu_count() * 0.50))

providers = ['CPUExecutionProvider']

ort_session = ort.InferenceSession(onnx_model_path, sess_options=sess_options, providers=providers)

input_audio_name = ort_session.get_inputs()[0].name
input_length_name = ort_session.get_inputs()[1].name

# ==========================================
# ==========================================
# ==========================================
# FIRST: CHUNKING ACCORDING TO SILENCE
# ==========================================
print("\n--- FIRST: CHUNKING ACCORDING TO SILENCE ---")
import subprocess
import time

print("Streaming audio directly into NumPy memory (zero-RAM load)...")
start_load = time.time()
cmd_audio = [
    'ffmpeg', '-hide_banner', '-nostats', '-i', audio_file,
    '-ar', '16000', '-ac', '1',
    '-f', 'f32le', '-'
]
proc_audio = subprocess.run(cmd_audio, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
full_audio_np = np.frombuffer(proc_audio.stdout, dtype=np.float32)
print(f"Loaded {len(full_audio_np) / 16000.0:.2f} seconds of audio in {time.time() - start_load:.2f}s.")

print("Calculating dynamic chunks using Vectorized Pydub math...")
def get_pydub_speech_ranges(audio_np, sample_rate=16000, min_silence_len=400, silence_thresh_offset=-14, seek_step=50, max_chunk_sec=15.0):
    rms = np.sqrt(np.mean(np.square(audio_np)))
    dbfs = 20 * np.log10(rms + 1e-10)
    thresh = dbfs + silence_thresh_offset
    
    chunk_samples = int(sample_rate * (seek_step / 1000.0))
    num_chunks = len(audio_np) // chunk_samples
    if num_chunks == 0:
        return [(0.0, len(audio_np) / sample_rate)]
        
    reshaped = audio_np[:num_chunks * chunk_samples].reshape(num_chunks, chunk_samples)
    chunk_rms = np.sqrt(np.mean(np.square(reshaped), axis=1))
    chunk_dbfs = 20 * np.log10(chunk_rms + 1e-10)
    is_speech = chunk_dbfs > thresh
    
    min_silence_chunks = int(min_silence_len / seek_step)
    silence_ranges = []
    current_silence_start = -1
    silence_len = 0
    
    for i, speech in enumerate(is_speech):
        if not speech:
            if current_silence_start == -1:
                current_silence_start = i
            silence_len += 1
        else:
            if current_silence_start != -1:
                if silence_len >= min_silence_chunks:
                    silence_ranges.append((current_silence_start, i))
                current_silence_start = -1
                silence_len = 0
                
    if current_silence_start != -1 and silence_len >= min_silence_chunks:
        silence_ranges.append((current_silence_start, len(is_speech)))
        
    speech_ranges_sec = []
    current_speech_start = 0
    
    for s_start, s_end in silence_ranges:
        if s_start > current_speech_start:
            speech_ranges_sec.append((current_speech_start * seek_step / 1000.0, s_start * seek_step / 1000.0))
        current_speech_start = s_end
        
    if current_speech_start < len(is_speech):
        speech_ranges_sec.append((current_speech_start * seek_step / 1000.0, (len(audio_np) / sample_rate)))
        
    # --- INTELLIGENT FORCED SPLIT ---
    # Ensure no chunk exceeds max_chunk_sec to prevent GPU Memory Crash
    final_ranges = []
    for start, end in speech_ranges_sec:
        while end - start > max_chunk_sec:
            chunk_dur = end - start
            target_split_dur = min(max_chunk_sec, chunk_dur / 2)
            
            search_start = start + target_split_dur * 0.5
            search_end = start + target_split_dur * 1.5
            
            s_idx = int(search_start * sample_rate)
            e_idx = int(search_end * sample_rate)
            
            block_size = int(sample_rate * 0.1) # 100ms blocks
            min_rms = float('inf')
            best_split_time = search_start
            
            for i in range(s_idx, e_idx - block_size, block_size):
                block_rms = np.mean(np.square(audio_np[i:i+block_size]))
                if block_rms < min_rms:
                    min_rms = block_rms
                    best_split_time = (i + block_size / 2) / sample_rate
            
            final_ranges.append((start, best_split_time))
            start = best_split_time
            
        final_ranges.append((start, end))
        
    return final_ranges

speech_ranges_sec = get_pydub_speech_ranges(full_audio_np, min_silence_len=400, silence_thresh_offset=-14)
print(f"Discovered {len(speech_ranges_sec)} chunks using Vectorized Math.")

# ==========================================
# SECOND: RAW TRANSCRIPTION & EXTRACTING LOGPROBS
# ==========================================
print("\n--- SECOND: RAW TRANSCRIPTION & EXTRACTING LOGPROBS ---")
OUTPUT_HOP_S = 0.080
chunk_path = str(PROJECT_ROOT / "outputs" / "runtime_clean_input.wav")
os.makedirs(PROJECT_ROOT / "outputs", exist_ok=True)

mel_extractor = LogMelExtractor(sample_rate=16000)
total_audio_sec = len(full_audio_np) / 16000.0

all_logprobs = [None] * len(speech_ranges_sec)
all_raw_text = [None] * len(speech_ranges_sec)
frame_to_time_chunks = [None] * len(speech_ranges_sec)

def transcribe_chunk(i, start_sec, end_sec):
    import time
    t0 = time.time()
    
    start_padded_sec = max(0.0, start_sec - 0.3)
    end_padded_sec = min(total_audio_sec, end_sec + 0.3)
    chunk_sec_offset = start_padded_sec
    
    start_sample = int(start_padded_sec * 16000)
    end_sample = int(end_padded_sec * 16000)
    
    wav_np = full_audio_np[start_sample:end_sample]
        
    features = mel_extractor(wav_np)         
    features = features[None, ...]
    length = np.array([features.shape[2]], dtype=np.int64)

    outputs = ort_session.run(
        ["logprobs"],
        {input_audio_name: features, input_length_name: length}
    )
    
    lp_numpy = outputs[0][0]  
    text_clean = ctc_decoder.decode(lp_numpy).strip()
    
    chunk_frames = []
    for frame_idx in range(lp_numpy.shape[0]):
        chunk_frames.append(chunk_sec_offset + frame_idx * OUTPUT_HOP_S)
        
    t1 = time.time()
    duration = t1 - t0
        
    return i, lp_numpy, text_clean, chunk_frames

print(f"Executing with ThreadPoolExecutor (Workers: {max_workers})...")
with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
    futures = [executor.submit(transcribe_chunk, i, start, end) for i, (start, end) in enumerate(speech_ranges_sec)]
    
    for future in tqdm(concurrent.futures.as_completed(futures), total=len(futures), desc="Transcribing", unit="chunk"):
        i, lp_numpy, text_clean, chunk_frames = future.result()
        all_logprobs[i] = lp_numpy
        if text_clean and text_clean.lower() != "none":
            all_raw_text[i] = text_clean
        else:
            all_raw_text[i] = ""
        frame_to_time_chunks[i] = chunk_frames

# Flatten chronological results
flat_raw_text = [t for t in all_raw_text if t]
full_text = " ".join(flat_raw_text)

frame_to_time = []
for frames in frame_to_time_chunks:
    frame_to_time.extend(frames)

raw_output_json = str(PROJECT_ROOT / "outputs" / "raw_transcription_output.json")
with open(raw_output_json, 'w', encoding='utf-8') as f:
    json.dump([full_text], f, ensure_ascii=False, indent=4)
print(f"[OK] Saved raw transcription string to: {raw_output_json}")

# ==========================================
# THIRD: AUTO SURAH FINDER
# ==========================================
print("\n--- THIRD: AUTO SURAH FINDER (OFFLINE-TARTEEL LOGIC) ---")
print("Loading quran.json and running optimal auto-detection...")
db = QuranDB()

def strip_intro_for_search(text):
    text_norm = normalize_arabic(text)
    words = text_norm.split()
    
    ist_target = normalize_arabic("اعوذ بالله من الشيطان الرجيم")
    bsm_target = normalize_arabic("بسم الله الرحمن الرحيم")
    
    ist_match_len = 0
    for i in range(4, min(9, len(words) + 1)):
        prefix = " ".join(words[:i])
        if ratio(ist_target, prefix) > 0.65:
            ist_match_len = i
            
    if ist_match_len > 0:
        words = words[ist_match_len:]
        
    bsm_match_len = 0
    for i in range(3, min(7, len(words) + 1)):
        prefix = " ".join(words[:i])
        if ratio(bsm_target, prefix) > 0.65:
            bsm_match_len = i
            
    if bsm_match_len > 0:
        words = words[bsm_match_len:]
        
    return " ".join(words)

search_text = strip_intro_for_search(full_text)

if args.multiple:
    print("Using Multi-Surah Dynamic Re-Anchoring...")
    best_match = db.find_multiple_ayah_ranges(search_text)
else:
    best_match = db.find_best_ayah_range(search_text)

if not best_match:
    print("Could not locate a confident match for this audio in the Quran DB.")
    sys.exit(1)

print(f"[OK] Matched Canonical Span: Surah {best_match['surah']}, Ayahs {best_match['ayah']} to {best_match['ayah_end']}")
print(f"Canonical text to align:\n{best_match['text']}")

# ==========================================
# FORTH: WORD TIMING & ALIGNING
# ==========================================
print("\n--- FORTH: WORD TIMING & ALIGNING ---")
global_logprobs = np.concatenate(all_logprobs, axis=0)

from Levenshtein import ratio
from QuranKarim.normalizer import normalize_arabic

canonical_text = best_match['text_clean']
cleaned_canonical = normalize_arabic(canonical_text)
target_words = cleaned_canonical.split()

# Check Bismillah logic
is_ayah_1 = best_match['ayahs_list'][0]['ayah'] == 1 and best_match['ayahs_list'][0]['surah'] not in (1, 9)
bismillah_spoken = True
if is_ayah_1:
    first_few_raw = " ".join(normalize_arabic(w) for w in full_text.split()[:6])
    if "بسم" not in first_few_raw and "بسم الله" not in first_few_raw and ratio("بسم الله", first_few_raw[:10]) < 0.5:
        bismillah_spoken = False

mapped_segments = [[] for _ in range(len(target_words))]

raw_target_text = normalize_arabic(full_text)
raw_target_words = raw_target_text.split()

print(f"Aligning against raw transcription ({len(raw_target_words)} words)...")

raw_token_ids = ctc_decoder.encode(raw_target_text)
print("Running Trellis Forced Alignment...")
frame_intervals = ctc_forced_align(global_logprobs, raw_token_ids, blank_id=blank_id)

all_raw_segments = []
start_frame = frame_intervals[0][0]
word_idx = 0
current_word_letters = []

for i in range(len(raw_token_ids)):
    if word_idx >= len(raw_target_words):
        break
        
    decoded_so_far = ctc_decoder.decode_ids(raw_token_ids[:i+1])
    expected_prefix = " ".join(raw_target_words[:word_idx+1])
    
    if args.letter:
        tok_char = ctc_decoder.decode_ids([raw_token_ids[i]])
        if tok_char and tok_char.strip():
            ls_idx = min(frame_intervals[i][0], len(frame_to_time) - 1)
            le_idx = min(frame_intervals[i][1], len(frame_to_time) - 1)
            current_word_letters.append({
                "char": tok_char,
                "start": round(frame_to_time[ls_idx], 3),
                "end": round(frame_to_time[le_idx], 3)
            })
    
    if len(decoded_so_far.replace(" ", "")) >= len(expected_prefix.replace(" ", "")):
        end_frame = frame_intervals[i][1]
        
        s_idx = min(start_frame, len(frame_to_time) - 1)
        e_idx = min(end_frame, len(frame_to_time) - 1)
        
        seg_dict = {
            "word": raw_target_words[word_idx],
            "start": round(frame_to_time[s_idx], 3),
            "end": round(frame_to_time[e_idx], 3),
            "score": 1.0
        }
        if args.letter:
            seg_dict["letters"] = current_word_letters
            
        all_raw_segments.append(seg_dict)
        
        word_idx += 1
        if args.letter:
            current_word_letters = []
        if i + 1 < len(raw_token_ids):
            start_frame = frame_intervals[i+1][0]


print(f"[OK] Extracted {len(all_raw_segments)} raw segments.")
best_match["text_clean"] = " ".join(v["text_clean"] for v in best_match["ayahs_list"])

last_matched_idx = 3 if (is_ayah_1 and not bismillah_spoken) else -1
for raw_seg in tqdm(all_raw_segments, desc="Mapping to Quran", unit="word"):
    w = raw_seg["word"]
    
    best_ratio = 0
    best_idx = last_matched_idx
    best_span = 1
    
    start_search = max(0, last_matched_idx - 30)
    if is_ayah_1 and not bismillah_spoken and start_search < 4:
        start_search = 4
    end_search = min(len(target_words), last_matched_idx + 100)
    
    for i in range(start_search, end_search):
        for span in range(1, 4):
            if i + span > len(target_words):
                break
                
            target_w = "".join([normalize_arabic(target_words[k]) for k in range(i, i+span)])
            r = ratio(w, target_w)
            
            expected_idx = last_matched_idx + 1 if last_matched_idx >= 0 else 0
            distance = abs(i - expected_idx)
            penalty = distance * 0.015
            
            r_penalized = r - penalty
            
            if r_penalized > best_ratio:
                best_ratio = r_penalized
                best_idx = i
                best_span = span
            
    threshold = 0.4
    if best_idx == 0:
        threshold = 0.1
        
    if best_ratio > threshold:
        for span_idx in range(best_span):
            idx_to_assign = best_idx + span_idx
            raw_seg_copy = dict(raw_seg)
            raw_seg_copy["canonical_idx"] = idx_to_assign
            mapped_segments[idx_to_assign].append(raw_seg_copy)
        last_matched_idx = best_idx + best_span - 1

print("[OK] Levenshtein mapping to Canonical text complete.")

# ==========================================
# FIFTH: OUTPUT SEGMENTED JSON & SLICE MP3
# ==========================================
print("\n--- FIFTH: OUTPUT SEGMENTED JSON & SLICE MP3 ---")

segmented_json = []
global_word_idx = 0
global_last_end_time = 0.0

for ayah_obj in best_match["ayahs_list"]:
    raw_ayah_words = ayah_obj.get("text_uthmani", ayah_obj.get("text_standard", "")).split()
    
    strip_bismillah_text = False
            
    merged_ayah_words = []
    pending_prefix = ""
    for w in raw_ayah_words:
        if not normalize_arabic(w).strip():
            if merged_ayah_words:
                merged_ayah_words[-1] += " " + w
            else:
                pending_prefix += w + " "
        else:
            merged_ayah_words.append(pending_prefix + w)
            pending_prefix = ""
            
    ayah_segments = []
    for w_idx, word_text in enumerate(merged_ayah_words):
        if global_word_idx < len(mapped_segments):
            raw_segs_for_this_word = mapped_segments[global_word_idx]
            
            if not raw_segs_for_this_word:
                ayah_segments.append({
                    "word": word_text,
                    "canonical_idx": w_idx,
                    "start": 0.0,
                    "end": 0.0,
                    "score": 0.0
                })
            else:
                word_segments = []
                for s in raw_segs_for_this_word:
                    ws = {"start": s["start"], "end": s["end"]}
                    if args.letter and "letters" in s:
                        ws["letters"] = s["letters"]
                    word_segments.append(ws)
                
                ayah_segments.append({
                    "word": word_text,
                    "canonical_idx": w_idx,
                    "start": raw_segs_for_this_word[0]["start"],
                    "end": raw_segs_for_this_word[-1]["end"],
                    "score": round(sum(s["score"] for s in raw_segs_for_this_word) / len(raw_segs_for_this_word), 2),
                    "segments": word_segments
                })
            global_word_idx += 1
        else:
            ayah_segments.append({
                "word": word_text,
                "canonical_idx": w_idx,
                "start": 0.0,
                "end": 0.0,
                "score": 0.0
            })
            global_word_idx += 1
    # ==========================================
    # PHASE 4.5: BLOCK INTERPOLATOR
    # ==========================================
    # The ASR model sometimes completely drops words (score = 0.0).
    # We find blocks of unrecognized words and mathematically interpolate 
    # their timestamps by splitting the silence gap between the adjacent recognized words.
    
    blocks = []
    current_block = []
    # Identify contiguous blocks of unrecognized words
    for i, w in enumerate(ayah_segments):
        if w.get("start") == 0.0 or not w.get("segments"):
            current_block.append(i)
        else:
            if current_block:
                blocks.append(current_block)
                current_block = []
    if current_block:
        blocks.append(current_block)
        
    for block in blocks:
        # Get the recognized words immediately before and after the missing block
        prev_idx = block[0] - 1
        next_idx = block[-1] + 1
        
        prev_word = ayah_segments[prev_idx] if prev_idx >= 0 else None
        next_word = ayah_segments[next_idx] if next_idx < len(ayah_segments) else None
        
        num_missing = len(block)
        
        # 1. Both bounds exist (The missing words are in the middle of the Ayah)
        if prev_word and next_word:
            # We iterate through every repetition pass of the previous word
            for p_seg in prev_word.get("segments", []):
                p_end = p_seg.get("end", 0.0)
                
                n_segs = next_word.get("segments", [])
                n_seg = None
                # Find the matching repetition pass for the next word
                for s in n_segs:
                    if s.get("start", 0.0) >= p_end - 0.5:
                        n_seg = s
                        break
                if not n_seg and n_segs:
                    n_seg = n_segs[-1]
                    
                n_start = n_seg.get("start", p_end) if n_seg else p_end
                
                start_t = p_end
                end_t = max(start_t, n_start)
                
                # Calculate the exact silence gap and slice it evenly
                gap = end_t - start_t
                step = gap / num_missing
                
                # Assign the interpolated timestamps to the missing words
                for i, missing_idx in enumerate(block):
                    m_start = round(start_t + i * step, 3)
                    m_end = round(start_t + (i + 1) * step, 3)
                    
                    if "segments" not in ayah_segments[missing_idx]:
                        ayah_segments[missing_idx]["segments"] = []
                    ayah_segments[missing_idx]["segments"].append({
                        "start": m_start,
                        "end": m_end
                    })
                    
        # 2. Only next_word exists (The missing words are at the START of the Ayah)
        elif next_word and not prev_word:
            for n_seg in next_word.get("segments", []):
                n_start = n_seg.get("start", 0.0)
                # We assume a 0.5s silence before the first word
                start_t = max(0.0, n_start - 0.5)
                end_t = n_start
                
                gap = end_t - start_t
                step = gap / num_missing
                
                for i, missing_idx in enumerate(block):
                    m_start = round(start_t + i * step, 3)
                    m_end = round(start_t + (i + 1) * step, 3)
                    if "segments" not in ayah_segments[missing_idx]:
                        ayah_segments[missing_idx]["segments"] = []
                    ayah_segments[missing_idx]["segments"].append({
                        "start": m_start,
                        "end": m_end
                    })
                    
        # 3. Only prev_word exists (The missing words are at the END of the Ayah)
        elif prev_word and not next_word:
            for p_seg in prev_word.get("segments", []):
                p_end = p_seg.get("end", 0.0)
                # We assume a 0.5s silence after the last word
                start_t = p_end
                end_t = p_end + 0.5
                
                gap = end_t - start_t
                step = gap / num_missing
                
                for i, missing_idx in enumerate(block):
                    m_start = round(start_t + i * step, 3)
                    m_end = round(start_t + (i + 1) * step, 3)
                    if "segments" not in ayah_segments[missing_idx]:
                        ayah_segments[missing_idx]["segments"] = []
                    ayah_segments[missing_idx]["segments"].append({
                        "start": m_start,
                        "end": m_end
                    })
                    
        # 4. Global start/end update
        # After building the segments array, update the global start/end variables
        for missing_idx in block:
            m_word = ayah_segments[missing_idx]
            if m_word.get("segments"):
                m_word["start"] = m_word["segments"][0]["start"]
                m_word["end"] = m_word["segments"][-1]["end"]
            
    if len(segmented_json) == 0 and len(ayah_segments) > 0:
        ayah_segments[0]["start"] = 0.0
        if ayah_segments[0].get("segments"):
            ayah_segments[0]["segments"][0]["start"] = 0.0
        
    out_text = ayah_obj.get("text_uthmani", ayah_obj.get("text_standard", ""))
    
    # NEW SPLIT LOGIC
    if ayah_obj["ayah"] == 1 and ayah_obj["surah"] not in (1, 9) and len(ayah_segments) >= 4:
        bismillah_spoken = any(w.get("score", 0.0) > 0.0 for w in ayah_segments if w.get("canonical_idx", 0) < 4)
        if bismillah_spoken:
            bismillah_words = [dict(w) for w in ayah_segments if w.get("canonical_idx", 0) < 4]
            for w in bismillah_words:
                if "canonical_idx" in w: del w["canonical_idx"]
                
            segmented_json.append({
                "surah": ayah_obj["surah"],
                "ayah": 0,
                "text": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
                "words": bismillah_words
            })
            
        ayah_segments = [w for w in ayah_segments if w.get("canonical_idx", 0) >= 4]
        out_text = " ".join(out_text.split()[4:])
        
    for w in ayah_segments:
        if "canonical_idx" in w:
            del w["canonical_idx"]
            
    segmented_json.append({
        "surah": ayah_obj["surah"],
        "ayah": ayah_obj["ayah"],
        "text": out_text,
        "words": ayah_segments
    })

    if ayah_segments:
        global_last_end_time = ayah_segments[-1]["end"]

# Post-processing: Ensure the absolute first word starts at 0.0 and filter unspoken ayahs
if len(segmented_json) > 0:
    filtered_json = []
    for ayah_data in segmented_json:
        # Check if ayah has at least one spoken word (score > 0)
        # Bismillah (ayah 0) is kept if it was generated
        if ayah_data.get("ayah") == 0 or any(w.get("score", 0.0) > 0.0 for w in ayah_data.get("words", [])):
            filtered_json.append(ayah_data)
            
    segmented_json = filtered_json

if len(segmented_json) > 0:
    for ayah_data in segmented_json:
        if len(ayah_data["words"]) > 0:
            ayah_data["words"][0]["start"] = 0.0
            if ayah_data["words"][0].get("segments"):
                ayah_data["words"][0]["segments"][0]["start"] = 0.0
            break

out_dir = PROJECT_ROOT / "outputs"
out_dir.mkdir(exist_ok=True)
out_json = out_dir / "segmented.json"

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(segmented_json, f, ensure_ascii=False, indent=4)
print(f"[OK] Saved fully aligned JSON to {out_json}")

if args.split:
    import subprocess
    print("\nSlicing Ayah MP3s instantly via FFmpeg...")
    os.makedirs(out_dir / "ayahs", exist_ok=True)
    
    for ayah_data in segmented_json:
        if not ayah_data["words"]:
            continue
            
        # Get start and end times in seconds, with 0.1s padding to catch syllables
        start_sec = max(0.0, ayah_data["words"][0]["start"] - 0.1)
        end_sec = min(total_audio_sec, ayah_data["words"][-1]["end"] + 0.1)
        duration = end_sec - start_sec
        
        s_num = ayah_data["surah"]
        a_num = ayah_data["ayah"]
        
        slice_path = out_dir / f"ayahs/{s_num:03d}_{a_num:03d}.mp3"
        
        # FFmpeg command for ultra-fast, highly accurate MP3 slicing
        # We put -ss BEFORE -i for lightning-fast input seeking
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start_sec:.3f}",
            "-i", audio_file,
            "-t", f"{duration:.3f}",
            "-c:a", "libmp3lame", "-q:a", "2", # Re-encode slice for frame-perfect cut accuracy
            str(slice_path)
        ]
        
        subprocess.run(cmd, check=True)
        print(f"  -> Exported {slice_path.name}")
        
    print("[OK] Audio slicing complete.")

print("\nDone!")
# ==========================================
# SIXTH: EXPORT QC SUBTITLES
# ==========================================
print("\n--- SIXTH: OUTPUT QC SUBTITLES ---")
qc_subtitles = []
subtitle_index = 1

# Create a fast lookup for original Ayah words to patch AI hallucinations
ayah_words_dict = {}
for ayah_data in segmented_json:
    key = f"{ayah_data['surah']}_{ayah_data['ayah']}"
    ayah_words_dict[key] = ayah_data.get("words", [])

qc_subtitles = []

def fill_missing_words(sub_words, s_num, a_num):
    if not sub_words:
        return []
    
    sub_words.sort(key=lambda x: x["word_idx"])
    min_idx = sub_words[0]["word_idx"]
    max_idx = sub_words[-1]["word_idx"]
    
    present_indices = {w["word_idx"]: w for w in sub_words}
    original_words = ayah_words_dict.get(f"{s_num}_{a_num}", [])
    
    filled_words = []
    for i in range(min_idx, max_idx + 1):
        if i in present_indices:
            fw = {
                "word_idx": i,
                "word": present_indices[i]["word"],
                "start": present_indices[i]["start"],
                "end": present_indices[i]["end"]
            }
            if args.letter and "letters" in present_indices[i]:
                fw["letters"] = present_indices[i]["letters"]
            filled_words.append(fw)
        else:
            orig_word = original_words[i]["word"] if i < len(original_words) else ""
            interpolated_time = filled_words[-1]["end"] if filled_words else 0
            # User instruction: "for a missing word don't add letters"
            filled_words.append({
                "word_idx": i,
                "word": orig_word,
                "start": interpolated_time,
                "end": interpolated_time
            })
            
    return filled_words

for ayah_data in segmented_json:
    surah = ayah_data.get("surah")
    ayah = ayah_data.get("ayah")
    words = ayah_data.get("words", [])

    ayah_segments = []
    
    for w_idx, word_obj in enumerate(words):
        word_text = word_obj.get("word", "")
        segs = word_obj.get("segments", [])
        
        # Filter out corrupt negative duration segments from C++ aligner!
        valid_segs = [s for s in segs if s.get("end", 0) >= s.get("start", 0)]
        
        if not valid_segs:
            if word_obj.get("start", 0) != 0 or word_obj.get("end", 0) != 0:
                if word_obj.get("end", 0) >= word_obj.get("start", 0):
                    ayah_segments.append({
                        "word_idx": w_idx,
                        "word": word_text,
                        "start": word_obj.get("start", 0),
                        "end": word_obj.get("end", 0)
                    })
        else:
            for s in valid_segs:
                ayah_segments.append({
                    "word_idx": w_idx,
                    "word": word_text,
                    "start": s.get("start", 0),
                    "end": s.get("end", 0)
                })

    # Sort segments strictly within this Ayah chronologically to prepare for grouping
    ayah_segments.sort(key=lambda x: x["start"])

    current_sub_words = []
    last_word_idx = -1
    last_word_end = -1
    
    # Iterate through every spoken word chronologically
    for seg in ayah_segments:
        is_repetition = False
        
        # Detect if the reciter started repeating a previous word
        if last_word_idx != -1:
            # If the current word's index is less than or equal to the last word's index, 
            # it means the reciter jumped backwards! This is a repetition.
            if seg["word_idx"] <= last_word_idx:
                is_repetition = True
            # If there is a massive silence gap (>0.5s), it might be a new repetition pass
            elif seg["start"] - last_word_end > 0.5:
                is_repetition = True
                
        # If we detect a repetition boundary, we flush the current subtitle group
        if current_sub_words and is_repetition:
            # We patch any dropped words in the group using the mathematical interpolator
            filled = fill_missing_words(current_sub_words, surah, ayah)
            qc_subtitles.append({
                "subtitle_index": 0, # Will be assigned sequentially later
                "surah": surah,
                "ayah": ayah,
                "is_repetition": True, # Flag this as a repetition block
                "start": round(filled[0]["start"], 3),
                "end": round(filled[-1]["end"], 3),
                "text": " ".join(w["word"] for w in filled),
                "words": filled
            })
            # Reset the group for the new repetition pass
            current_sub_words = []
            
        # Add the word to the current subtitle group
        csw = {
            "word_idx": seg["word_idx"],
            "word": seg["word"],
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3)
        }
        if args.letter and "letters" in seg:
            csw["letters"] = seg["letters"]
        current_sub_words.append(csw)
        
        last_word_idx = seg["word_idx"]
        last_word_end = seg["end"]
        
    if current_sub_words:
        filled = fill_missing_words(current_sub_words, surah, ayah)
        qc_subtitles.append({
            "subtitle_index": 0,
            "surah": surah,
            "ayah": ayah,
            "is_repetition": False, # The final chunk of an Ayah is the main pass
            "start": round(filled[0]["start"], 3),
            "end": round(filled[-1]["end"], 3),
            "text": " ".join(w["word"] for w in filled),
            "words": filled
        })

# Global Chronological Sort to fix Time Travel across Ayahs
qc_subtitles.sort(key=lambda x: x["start"])

# Reassign chronological indices
for i, sub in enumerate(qc_subtitles):
    sub["subtitle_index"] = i + 1

qc_out_json = out_dir / "qc_subtitles.json"
with open(qc_out_json, "w", encoding="utf-8") as f:
    json.dump(qc_subtitles, f, ensure_ascii=False, indent=4)
print(f"[OK] Saved QC Subtitles to {qc_out_json}")
