"""
decoder.py

Provides the CTCDecoder class to handle text-to-token encoding and
CTC log-probability decoding. Implements standard greedy CTC decoding
by collapsing consecutive identical tokens and removing the blank token.
"""

import numpy as np

class CTCDecoder:
    def __init__(self, vocab_json: dict):
        self.vocab = {}
        max_id = 0
        for id_str, token in vocab_json.items():
            num_id = int(id_str)
            self.vocab[num_id] = token
            if num_id > max_id:
                max_id = num_id
        self.blank_id = max_id
        
        # Build token to id mapping (excluding blank)
        self.token_to_id = {v: k for k, v in self.vocab.items() if k != self.blank_id}
        # Sort tokens by length descending for greedy matching
        self.sorted_tokens = sorted(self.token_to_id.keys(), key=len, reverse=True)
        self.vocab_size = max_id + 1

    def encode(self, text: str) -> list[int]:
        # Prepend the sentencepiece space indicator
        text = text.replace(" ", "\u2581")
        if not text.startswith("\u2581"):
            text = "\u2581" + text
            
        ids = []
        i = 0
        while i < len(text):
            match_found = False
            for tok in self.sorted_tokens:
                if text.startswith(tok, i):
                    ids.append(self.token_to_id[tok])
                    i += len(tok)
                    match_found = True
                    break
            if not match_found:
                # fallback, just skip
                i += 1
        return ids

    def decode(self, logprobs: np.ndarray) -> str:
        # argmax per timestep
        ids = np.argmax(logprobs, axis=-1)
        
        # Collapse consecutive duplicates, remove blanks
        tokens = []
        prev = -1
        for id_val in ids:
            if id_val != prev and id_val != self.blank_id:
                token = self.vocab.get(id_val, "")
                tokens.append(token)
            prev = id_val
            
        # BPE detokenize: join tokens, replace ▁ with space
        joined = "".join(tokens)
        return joined.replace("\u2581", " ").strip()

    def decode_ids(self, ids: list[int]) -> str:
        tokens = [self.vocab.get(id_val, "") for id_val in ids]
        return "".join(tokens).replace("\u2581", " ").strip()

    def decode_with_timestamps(self, logprobs: np.ndarray, chunk_start_sec: float, hop_sec: float) -> list[dict]:
        ids = np.argmax(logprobs, axis=-1)
        
        words = []
        current_word = ""
        current_word_start = -1.0
        last_frame_time = chunk_start_sec
        
        prev = -1
        for frame_idx, id_val in enumerate(ids):
            frame_time = chunk_start_sec + frame_idx * hop_sec
            last_frame_time = frame_time
            
            if id_val != prev and id_val != self.blank_id:
                token = self.vocab.get(id_val, "")
                
                # SentencePiece space marker indicates a new word
                if token.startswith("\u2581"):
                    if current_word.strip():
                        words.append({
                            "word": current_word.replace("\u2581", "").strip(),
                            "start": current_word_start,
                            "end": frame_time
                        })
                    current_word = token
                    current_word_start = frame_time
                else:
                    if not current_word:
                        current_word_start = frame_time
                    current_word += token
                    
            prev = id_val
            
        if current_word.replace("\u2581", "").strip():
            words.append({
                "word": current_word.replace("\u2581", "").strip(),
                "start": current_word_start,
                "end": last_frame_time
            })
            
        return words
