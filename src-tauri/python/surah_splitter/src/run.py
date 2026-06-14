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
    python src/run.py [audio_file] [--split] [--caption]
"""

import os
import sys
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
import json
import argparse
import numpy as np
from pathlib import Path

# --- NEW ONNX DEPENDENCIES ---
import onnxruntime as ort
from audio_features import LogMelExtractor, load_wav_mono_16k
# -----------------------------

# Local pure files
from quran_db import QuranDB
from aligner import ctc_forced_align
from decoder import CTCDecoder

SCRIPT_DIR = Path(__file__).parent.absolute()
DATA_DIR = Path(os.environ.get("QURANCAPTION_SURAH_SPLITTER_DATA_DIR", SCRIPT_DIR.parent / "data"))
OUTPUT_DIR = Path(os.environ.get("QURANCAPTION_SURAH_SPLITTER_OUTPUT_DIR", SCRIPT_DIR.parent / "outputs"))

# ----------------------------------------------------
# COMMAND LINE SETUP
# ----------------------------------------------------
parser = argparse.ArgumentParser(description="Quranic Auto-Segmenter")
parser.add_argument("audio_file", nargs='?', default="../audio.mp3", help="Path to audio file.")
parser.add_argument("--split", action="store_true", help="Split MP3s per Ayah")
parser.add_argument("--caption", action="store_true", help="Format JSON output for captions (split Ayahs on repetitions)")
args = parser.parse_args()
audio_file = args.audio_file

if not os.path.exists(audio_file):
    print(f"Error: Could not find '{audio_file}'.")
    sys.exit(1)

# ----------------------------------------------------
# INITIALIZATION
# ----------------------------------------------------
print("\nInitializing Quantized FastConformer Quranic ONNX Model...")
onnx_model_path = DATA_DIR / "model.onnx"

# 1. Load Vocab and init Decoder
vocab_path = DATA_DIR / "vocab.json"
with open(vocab_path, "r", encoding="utf-8") as f:
    vocab_data = json.load(f)
ctc_decoder = CTCDecoder(vocab_data)
blank_id = ctc_decoder.blank_id

# 2. Load ONNX Session
import multiprocessing
sess_options = ort.SessionOptions()
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

# CLAMP THREADS TO 4: Prevents the CPU from hitting 100% and stalling the GPU
sess_options.intra_op_num_threads = 4
sess_options.inter_op_num_threads = 1
# Disable memory pattern which causes bloat on DirectML dynamic axes
sess_options.enable_mem_pattern = False

# Auto-detects NVIDIA GPU, then any Windows GPU (AMD/Intel via DirectML), falls back to CPU.
available_providers = set(ort.get_available_providers())
if os.environ.get("QURANCAPTION_SURAH_SPLITTER_DEVICE", "GPU").upper() == "CPU":
    provider_candidates = ["CPUExecutionProvider"]
else:
    provider_candidates = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
providers = [provider for provider in provider_candidates if provider in available_providers]
if not providers:
    providers = ["CPUExecutionProvider"]
ort_session = ort.InferenceSession(onnx_model_path, sess_options=sess_options, providers=providers)
output_name = "logprobs" if "logprobs" in [output.name for output in ort_session.get_outputs()] else ort_session.get_outputs()[0].name

input_audio_name = ort_session.get_inputs()[0].name
input_length_name = ort_session.get_inputs()[1].name

# ==========================================
# ==========================================
# ==========================================
# FIRST: CHUNKING ACCORDING TO SILENCE
# ==========================================
print("\n--- FIRST: CHUNKING ACCORDING TO SILENCE ---")
print("Loading audio and calculating dynamic chunks using Pydub...")

from pydub import AudioSegment
from pydub.silence import detect_nonsilent

full_audio = AudioSegment.from_file(audio_file).set_frame_rate(16000).set_channels(1)

# Lowered threshold to -14 to catch quiet trailing letters/breathing
# Lowered min_silence_len to 400 to break the audio into smaller chunks (avoids GPU memory crash)
speech_ranges = detect_nonsilent(
    full_audio, 
    min_silence_len=400, 
    silence_thresh=full_audio.dBFS - 14, 
    seek_step=50
)
print(f"Discovered {len(speech_ranges)} chunks using Pydub.")

# ==========================================
# SECOND: RAW TRANSCRIPTION & EXTRACTING LOGPROBS
# ==========================================
print("\n--- SECOND: RAW TRANSCRIPTION & EXTRACTING LOGPROBS ---")
all_raw_text = []
all_logprobs = []
frame_to_time = []
OUTPUT_HOP_S = 0.080
chunk_path = OUTPUT_DIR / "runtime_clean_input.wav"
os.makedirs(OUTPUT_DIR, exist_ok=True)

mel_extractor = LogMelExtractor(sample_rate=16000)

for i, (start_ms, end_ms) in enumerate(speech_ranges):
    # Increased padding to 300ms to preserve breathing/waqf tails
    start_padded = max(0, start_ms - 300)
    end_padded = min(len(full_audio), end_ms + 300)
    chunk_sec_offset = start_padded / 1000.0
    
    chunk = full_audio[start_padded:end_padded]
    
    # --- IN-MEMORY CONVERSION ---
    samples = np.array(chunk.get_array_of_samples())
    if chunk.sample_width == 2:
        wav_np = samples.astype(np.float32) / 32768.0
    elif chunk.sample_width == 4:
        wav_np = samples.astype(np.float32) / 2147483648.0
    else:
        wav_np = samples.astype(np.float32)
        
    # --- ONNX INFERENCE BLOCK ---
    # 1. We MUST use the mel_extractor now because our Sherpa model expects 80-dim features!
    features = mel_extractor(wav_np)         
    features = features[None, ...]  # Shape becomes [1, 80, Time]         
    length = np.array([features.shape[2]], dtype=np.int64)

    # 2. Run the session. 
    # Notice we use ["logprobs"] (no underscore) because we explicitly named it that in Colab!
    outputs = ort_session.run(
        [output_name],
        {input_audio_name: features, input_length_name: length}
    )
    
    lp_numpy = outputs[0][0]  
    all_logprobs.append(lp_numpy)
    
    text_clean = ctc_decoder.decode(lp_numpy).strip()
    
    if text_clean and text_clean.lower() != "none":
        all_raw_text.append(text_clean)
        
    for frame_idx in range(lp_numpy.shape[0]):
        frame_to_time.append(chunk_sec_offset + frame_idx * OUTPUT_HOP_S)

full_text = " ".join(all_raw_text)

raw_output_json = OUTPUT_DIR / "raw_transcription_output.json"
with open(raw_output_json, 'w', encoding='utf-8') as f:
    json.dump([full_text], f, ensure_ascii=False, indent=4)
print(f"[OK] Saved raw transcription string to: {raw_output_json}")

# ==========================================
# THIRD: AUTO SURAH FINDER
# ==========================================
print("\n--- THIRD: AUTO SURAH FINDER (OFFLINE-TARTEEL LOGIC) ---")
print("Loading quran.json and running optimal auto-detection...")
db = QuranDB()
best_match = db.find_best_ayah_range(full_text)

if not best_match:
    print("Could not locate a confident match for this audio in the Quran DB.")
    sys.exit(1)

print(f"[OK] Matched Canonical Span: Surah {best_match['surah']}, Ayahs {best_match['ayah']} to {best_match['ayah_end']}")
print(f"Canonical text to align:\n{best_match['text']}")

# ==========================================
# FORTH: WORD TIMING & ALIGNING (RAW TEXT)
# ==========================================
print("\n--- FORTH: WORD TIMING & ALIGNING ---")
global_logprobs = np.concatenate(all_logprobs, axis=0)

from Levenshtein import ratio

# 1. Align to RAW transcription to get tight timestamps for all repetitions
from normalizer import normalize_arabic
raw_target_text = normalize_arabic(full_text)
raw_target_words = raw_target_text.split()

print(f"Aligning against raw transcription ({len(raw_target_words)} words)...")

raw_token_ids = ctc_decoder.encode(raw_target_text)
print("Running Trellis Forced Alignment...")
frame_intervals = ctc_forced_align(global_logprobs, raw_token_ids, blank_id=blank_id)

all_raw_segments = []
start_frame = frame_intervals[0][0]
word_idx = 0

for i in range(len(raw_token_ids)):
    if word_idx >= len(raw_target_words):
        break
        
    decoded_so_far = ctc_decoder.decode_ids(raw_token_ids[:i+1])
    expected_prefix = " ".join(raw_target_words[:word_idx+1])
    
    if len(decoded_so_far.replace(" ", "")) >= len(expected_prefix.replace(" ", "")):
        end_frame = frame_intervals[i][1]
        
        s_idx = min(start_frame, len(frame_to_time) - 1)
        e_idx = min(end_frame, len(frame_to_time) - 1)
        
        all_raw_segments.append({
            "word": raw_target_words[word_idx],
            "start": round(frame_to_time[s_idx], 3),
            "end": round(frame_to_time[e_idx], 3),
            "score": 1.0
        })
        
        word_idx += 1
        if i + 1 < len(raw_token_ids):
            start_frame = frame_intervals[i+1][0]

print(f"[OK] Extracted {len(all_raw_segments)} raw segments.")

# Rebuild canonical_text without stripping Bismillah early, so raw transcription maps correctly!
best_match["text_clean"] = " ".join(v["text_clean"] for v in best_match["ayahs_list"])
# -----------------------

# 2. Map raw segments to Canonical text
canonical_text = best_match['text_clean']
cleaned_canonical = normalize_arabic(canonical_text)
target_words = cleaned_canonical.split()

mapped_segments = [[] for _ in range(len(target_words))]

last_matched_idx = -1
for raw_seg in all_raw_segments:
    w = raw_seg["word"]
    
    best_ratio = 0
    best_idx = last_matched_idx
    
    # Expand search window to handle transcriber skips (large forward window)
    # but keep backward window small to prevent mapping to distant past words
    start_search = max(0, last_matched_idx - 30)
    end_search = min(len(target_words), last_matched_idx + 100)
    
    for i in range(start_search, end_search):
        target_w = normalize_arabic(target_words[i])
        r = ratio(w, target_w)
        
        # Distance penalty to break ties (prefer words closer to expected position)
        expected_idx = last_matched_idx + 1 if last_matched_idx >= 0 else 0
        distance = abs(i - expected_idx)
        penalty = distance * 0.015
        
        r_penalized = r - penalty
        
        if r_penalized > best_ratio:
            best_ratio = r_penalized
            best_idx = i
            
    # Use the actual UNPENALIZED ratio for display, but use PENALIZED ratio to decide if it's valid
    actual_ratio = ratio(w, normalize_arabic(target_words[best_idx])) if best_idx >= 0 else 0
    
    threshold = 0.4
    if best_idx == 0:  # Force match the first word if it's garbage (often happens with Muqatta'at)
        threshold = 0.1
        
    # CRITICAL FIX: Use best_ratio (which includes the distance penalty) to prevent random 
    # AI hallucinations from falsely mapping to words far backwards in the timeline!
    if best_ratio > threshold:
        mapped_segments[best_idx].append(raw_seg)
        last_matched_idx = best_idx

print("[OK] Levenshtein mapping to Canonical text complete.")

# ==========================================
# FIFTH: OUTPUT SEGMENTED JSON & SLICE MP3
# ==========================================
print("\n--- FIFTH: OUTPUT SEGMENTED JSON & SLICE MP3 ---")

segmented_json = []
global_word_idx = 0

for ayah_obj in best_match["ayahs_list"]:
    raw_ayah_words = ayah_obj.get("text_uthmani", ayah_obj.get("text_standard", "")).split()
    
    # Dynamic Bismillah handling will be evaluated after segment mapping
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
            # Build segment mapping
            # Because Option B was selected, if a canonical word has multiple raw segments (repetitions),
            # we output ALL of them as consecutive objects in the JSON array!
            raw_segs_for_this_word = mapped_segments[global_word_idx]
            
            if not raw_segs_for_this_word:
                # If missed completely, insert a placeholder with 0 duration
                ayah_segments.append({
                    "word": word_text,
                    "canonical_idx": w_idx,
                    "start": 0.0,
                    "end": 0.0,
                    "score": 0.0
                })
            else:
                # Group segments into "instances" to handle ASR splits vs True repetitions
                canonical_clean = normalize_arabic(word_text)
                instances = []
                current_text = ""
                current_group = []
                
                for r_seg in raw_segs_for_this_word:
                    w = normalize_arabic(r_seg["word"])
                    if not current_text:
                        current_text = w
                        current_group.append(r_seg)
                        continue
                        
                    combined = current_text + w
                    r_combined = ratio(combined, canonical_clean)
                    r_new = ratio(w, canonical_clean)
                    
                    if r_new > r_combined:
                        instances.append(current_group)
                        current_text = w
                        current_group = [r_seg]
                    else:
                        current_text = combined
                        current_group.append(r_seg)
                
                if current_group:
                    instances.append(current_group)
                    
                for inst in instances:
                    # Merge the grouped segments into one output object
                    ayah_segments.append({
                        "word": word_text,
                        "canonical_idx": w_idx,
                        "start": inst[0]["start"],
                        "end": inst[-1]["end"],
                        "score": sum(s["score"] for s in inst) / len(inst)
                    })
                    
            global_word_idx += 1
            
    # 0. Dynamic Bismillah Stripping
    if ayah_obj["ayah"] == 1 and ayah_obj["surah"] not in (1, 9) and len(ayah_segments) >= 4:
        # Check if the reciter actually spoke Bismillah (score > 0)
        bismillah_spoken = any(w["score"] > 0.0 for w in ayah_segments if w.get("canonical_idx", 0) < 4)
        if not bismillah_spoken:
            ayah_segments = [w for w in ayah_segments if w.get("canonical_idx", 0) >= 4]
            strip_bismillah_text = True
            
    # 1. Interpolate missing words (start == 0.0)
    for i in range(len(ayah_segments)):
        if ayah_segments[i]["start"] == 0.0:
            prev_end = 0.0
            if i > 0:
                prev_end = ayah_segments[i - 1]["end"]
                
            next_start = prev_end + 0.2
            for j in range(i + 1, len(ayah_segments)):
                if ayah_segments[j]["start"] != 0.0:
                    next_start = ayah_segments[j]["start"]
                    break
                    
            # Place the missed word in the gap
            gap = max(0.01, next_start - prev_end)
            ayah_segments[i]["start"] = round(prev_end + gap * 0.1, 2)
            ayah_segments[i]["end"] = round(prev_end + gap * 0.9, 2)
            
    # 2. Sort chronologically to naturally reconstruct the reciter's repetitions
    ayah_segments.sort(key=lambda x: x["start"])
    
    # 3. Force the very first word of the entire audio to start at 0.0s 
    # (Captures skipped first words and Muqatta'at starts perfectly)
    if len(segmented_json) == 0 and len(ayah_segments) > 0:
        ayah_segments[0]["start"] = 0.0
    
    out_text = ayah_obj.get("text_uthmani", ayah_obj.get("text_standard", ""))
    if strip_bismillah_text:
        out_text = " ".join(out_text.split()[4:])
        
    if args.caption:
        sub_segments = []
        current_sub = []
        last_idx = -1
        
        for w in ayah_segments:
            # If the canonical index drops (or is same), the reciter jumped back to repeat
            if w["canonical_idx"] <= last_idx and current_sub:
                sub_segments.append(current_sub)
                current_sub = []
            current_sub.append(w)
            last_idx = w["canonical_idx"]
            
        if current_sub:
            sub_segments.append(current_sub)
            
        for i, sub in enumerate(sub_segments):
            sub_text = " ".join([w["word"] for w in sub])
                    
            segmented_json.append({
                "surah": ayah_obj["surah"],
                "ayah": ayah_obj["ayah"],
                "segment": i + 1,
                "text": sub_text,
                "words": sub
            })
    else:
        # Remove canonical_idx to keep JSON clean in standard mode
        for w in ayah_segments:
            if "canonical_idx" in w:
                del w["canonical_idx"]
                
        segmented_json.append({
            "surah": ayah_obj["surah"],
            "ayah": ayah_obj["ayah"],
            "text": out_text,
            "words": ayah_segments
        })

out_dir = OUTPUT_DIR
out_dir.mkdir(exist_ok=True)
out_json = out_dir / "segmented.json"

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(segmented_json, f, ensure_ascii=False, indent=4)
print(f"[OK] Saved fully aligned JSON to {out_json}")

if args.split:
    print("\nSlicing Ayah MP3s...")
    os.makedirs(out_dir / "ayahs", exist_ok=True)
    for ayah_data in segmented_json:
        if not ayah_data["words"]:
            continue
            
        start_ms = max(0, int(ayah_data["words"][0]["start"] * 1000) - 100)
        end_ms = min(len(full_audio), int(ayah_data["words"][-1]["end"] * 1000) + 100)
        
        s_num = ayah_data["surah"]
        a_num = ayah_data["ayah"]
        
        slice_path = out_dir / f"ayahs/{s_num:03d}_{a_num:03d}.mp3"
        full_audio[start_ms:end_ms].export(slice_path, format="mp3")
        print(f"  -> Exported {slice_path.name}")
        
    print("[OK] Audio slicing complete.")

print("\nDone!")
