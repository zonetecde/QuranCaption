"""Orchestration for phoneme-based alignment and retries."""

from typing import List, Tuple

from config import (
    ANCHOR_SEGMENTS,
    MAX_CONSECUTIVE_FAILURES,
    RETRY_LOOKBACK_WORDS,
    RETRY_LOOKAHEAD_WORDS,
    MAX_EDIT_DISTANCE_RELAXED,
    PHONEME_ALIGNMENT_PROFILING,
)


def run_phoneme_matching(
    phoneme_texts: List[List[str]],
    detected_surah: int,
    first_quran_idx: int = 0,
    special_results: List[tuple] = None,
    start_pointer: int = 0,
) -> Tuple[List[tuple], dict, set, dict]:
    """
    Phoneme-based segment matching using substring DP.

    Args:
        phoneme_texts: List of phoneme lists (each is a list of phoneme strings)
        detected_surah: Surah number from anchor search
        first_quran_idx: Index where Quran segments start (after specials)
        special_results: Results for special segments (Isti'adha/Basmala)
        start_pointer: Initial word pointer from anchor voting

    Returns:
        (results, profiling_dict, gap_segments, merged_into)
        results: List[(matched_text, score, matched_ref), ...]
        merged_into: dict mapping consumed segment indices to their target segment index
    """
    from .phoneme_matcher import align_segment, get_matched_text
    from .phoneme_matcher_cache import get_chapter_reference
    from .phoneme_anchor import reanchor_within_surah, verse_to_word_index, find_anchor_by_voting
    from .ngram_index import get_ngram_index

    # Only import time if profiling enabled
    if PHONEME_ALIGNMENT_PROFILING:
        import time
        total_start = time.perf_counter()
        ref_build_start = time.perf_counter()

    # Build/get cached chapter reference (includes phonemizer call if not cached)
    chapter_ref = get_chapter_reference(detected_surah)

    if PHONEME_ALIGNMENT_PROFILING:
        ref_build_time = time.perf_counter() - ref_build_start

    # Initialize results with special segments
    results = list(special_results) if special_results else []
    # Parallel list: None for specials/failures, (start_word_idx, end_word_idx) for matches
    word_indices = [None] * len(results)

    # Timing accumulators (only used if profiling enabled)
    if PHONEME_ALIGNMENT_PROFILING:
        dp_times = []
        window_setup_total = 0.0
        result_build_total = 0.0

    # Track whether the next segment might have Basmala fused with verse content
    from .special_segments import (
        SPECIAL_PHONEMES, SPECIAL_TEXT, TRANSITION_TEXT,
        detect_transition_segment, detect_inter_chapter_specials,
    )
    basmala_already_detected = any(
        r[2] in ("Basmala", "Isti'adha+Basmala") for r in (special_results or [])
    )
    is_first_after_transition = not basmala_already_detected

    special_merges = 0

    # Transition segment state
    transition_mode = False
    transition_skips = 0
    tahmeed_merge_skip = 0
    merged_into = {}  # {consumed_idx: target_idx}

    # Gap tracking (initialized here so inline chapter-transition checks can add entries)
    gap_segments = set()
    transition_expected_pointer = -1  # -1 = no pending check

    def _check_transition_gap(start_word_idx):
        """Flag missing words at start of new chapter after transition."""
        nonlocal transition_expected_pointer
        if transition_expected_pointer < 0:
            return
        if start_word_idx > transition_expected_pointer:
            seg_idx = len(word_indices) - 1
            gap_segments.add(seg_idx)
            gap = start_word_idx - transition_expected_pointer
            print(f"  [GAP] {gap} word(s) missing at start of chapter after transition "
                  f"(expected word {transition_expected_pointer}, got {start_word_idx})")
        transition_expected_pointer = -1

    # Process Quran segments with phoneme alignment
    pointer = start_pointer
    num_segments = 0
    consecutive_failures = 0
    skip_count = 0
    pending_specials = []
    tier1_attempts = 0
    tier1_passed = 0
    tier1_segments = []
    tier2_attempts = 0
    tier2_passed = 0
    tier2_segments = []
    consec_reanchors = 0
    segments_attempted = 0
    segments_passed = 0

    for i, asr_phonemes in enumerate(phoneme_texts[first_quran_idx:]):
        # Handle segments consumed by inter-chapter special detection
        if skip_count > 0:
            results.append(pending_specials.pop(0))
            word_indices.append(None)
            skip_count -= 1
            continue

        # Handle segments consumed by Tahmeed merge (sami'a + rabbana in separate segments)
        if tahmeed_merge_skip > 0:
            # This segment's audio was merged into the previous Tahmeed segment
            results.append(("", 0.0, ""))
            word_indices.append(None)
            tahmeed_merge_skip -= 1
            transition_skips += 1
            continue

        segment_idx = first_quran_idx + i + 1  # 1-indexed for display
        segments_attempted += 1

        # Transition mode: keep checking for transitions before trying alignment
        if transition_mode:
            trans_name, trans_conf = detect_transition_segment(asr_phonemes)
            if trans_name:
                print(f"  [TRANSITION-MODE] Segment {segment_idx}: {trans_name} (conf={trans_conf:.2f})")
                results.append((TRANSITION_TEXT[trans_name], trans_conf, trans_name))
                word_indices.append(None)
                transition_skips += 1

                # Tahmeed peek-ahead for merge
                if trans_name == "Tahmeed":
                    next_abs = first_quran_idx + i + 1
                    if next_abs < len(phoneme_texts) and phoneme_texts[next_abs]:
                        resp_name, resp_conf = detect_transition_segment(
                            phoneme_texts[next_abs], allowed={"Tahmeed"})
                        if resp_name:
                            merged_into[next_abs] = first_quran_idx + i
                            tahmeed_merge_skip = 1
                            print(f"  [TAHMEED-MERGE] Next segment merged into Tahmeed")

                continue
            else:
                # Exit transition mode, global reanchor
                transition_mode = False
                print(f"  [TRANSITION-MODE] Exiting at segment {segment_idx}, running global reanchor...")
                remaining_idx = first_quran_idx + i
                remaining_texts = phoneme_texts[remaining_idx:]
                if remaining_texts:
                    reanchor_surah, reanchor_ayah = find_anchor_by_voting(
                        remaining_texts, get_ngram_index(), ANCHOR_SEGMENTS,
                    )
                    if reanchor_surah > 0:
                        if reanchor_surah != detected_surah:
                            detected_surah = reanchor_surah
                            chapter_ref = get_chapter_reference(detected_surah)
                        pointer = verse_to_word_index(chapter_ref, reanchor_ayah)
                        transition_expected_pointer = pointer
                        print(f"  [GLOBAL-REANCHOR] Jumped to Surah {detected_surah}, "
                              f"Ayah {reanchor_ayah}, word {pointer}")
                    consecutive_failures = 0
                # Fall through to normal alignment below

        alignment, timing = align_segment(asr_phonemes, chapter_ref, pointer, segment_idx)
        num_segments += 1

        # Accumulate timing if profiling enabled
        if PHONEME_ALIGNMENT_PROFILING:
            dp_times.append(timing['dp_time'])
            window_setup_total += timing['window_setup_time']
            result_build_total += timing['result_build_time']

        # Chapter transition: pointer past end of chapter
        if alignment is None and pointer >= chapter_ref.num_words:
            remaining_phonemes = phoneme_texts[first_quran_idx + i:]
            amin_consumed = 0

            if chapter_ref.surah == 1:
                # Check for Amin after Al-Fatiha before inter-chapter specials
                amin_name, amin_conf = detect_transition_segment(
                    asr_phonemes, allowed={"Amin"})
                if amin_name:
                    print(f"  [AMIN] Detected after Surah 1 (conf={amin_conf:.2f})")
                    results.append((TRANSITION_TEXT["Amin"], amin_conf, "Amin"))
                    word_indices.append(None)
                    transition_skips += 1
                    amin_consumed = 1
                    # Re-slice remaining phonemes to start after Amin
                    remaining_phonemes = phoneme_texts[first_quran_idx + i + 1:]

            inter_specials, num_consumed = detect_inter_chapter_specials(remaining_phonemes)

            if chapter_ref.surah == 1:
                # After Al-Fatiha, the next chapter could be anything — global reanchor
                print(f"  [CHAPTER-END] Surah 1 complete at segment {segment_idx}, "
                      f"running global reanchor...")

                # Use segments after Amin + specials for anchor voting
                anchor_offset = first_quran_idx + i + amin_consumed + num_consumed
                anchor_remaining = phoneme_texts[anchor_offset:]

                reanchor_surah, reanchor_ayah = find_anchor_by_voting(
                    anchor_remaining, get_ngram_index(), ANCHOR_SEGMENTS,
                )

                if reanchor_surah > 0:
                    next_surah = reanchor_surah
                    chapter_ref = get_chapter_reference(next_surah)
                    pointer = verse_to_word_index(chapter_ref, reanchor_ayah)
                    # Don't set transition_expected_pointer — after Surah 1 the next
                    # chapter is arbitrary (global reanchor), so gaps are expected.
                    print(f"  [GLOBAL-REANCHOR] Anchored to Surah {next_surah}, "
                          f"Ayah {reanchor_ayah}, word {pointer}")
                else:
                    # Fallback: assume chapter 2
                    next_surah = 2
                    chapter_ref = get_chapter_reference(next_surah)
                    pointer = 0
                    print(f"  [GLOBAL-REANCHOR] No anchor found, falling back to Surah 2")
            else:
                next_surah = chapter_ref.surah + 1
                if next_surah > 114:
                    pass  # No more chapters — fall through to failure handling
                else:
                    # Check for transition before committing to next sequential surah
                    if num_consumed == 0:
                        trans_name, trans_conf = detect_transition_segment(asr_phonemes)
                        if trans_name:
                            print(f"  [CHAPTER-END-TRANSITION] Segment {segment_idx}: {trans_name} "
                                  f"at end of Surah {chapter_ref.surah} (conf={trans_conf:.2f})")
                            results.append((TRANSITION_TEXT[trans_name], trans_conf, trans_name))
                            word_indices.append(None)
                            transition_skips += 1
                            transition_mode = True
                            detected_surah = next_surah
                            chapter_ref = get_chapter_reference(next_surah)
                            pointer = 0
                            transition_expected_pointer = 0
                            consecutive_failures = 0
                            continue

                    print(f"  [CHAPTER-END] Surah {chapter_ref.surah} complete at segment {segment_idx}, "
                          f"transitioning to Surah {next_surah}")
                    chapter_ref = get_chapter_reference(next_surah)
                    pointer = 0
                    transition_expected_pointer = 0

            if next_surah <= 114:
                detected_surah = next_surah
                consecutive_failures = 0

                if amin_consumed > 0:
                    # Current segment was Amin (already appended above).
                    # Queue inter-chapter specials for subsequent segments.
                    has_basmala = any(s[2] in ("Basmala", "Isti'adha+Basmala") for s in inter_specials)
                    is_first_after_transition = not has_basmala
                    if num_consumed > 0:
                        pending_specials = list(inter_specials)
                        skip_count = num_consumed
                    else:
                        is_first_after_transition = True
                    continue

                if num_consumed > 0:
                    has_basmala = any(s[2] in ("Basmala", "Isti'adha+Basmala") for s in inter_specials)
                    is_first_after_transition = not has_basmala
                    # Current segment is a special — append its result
                    results.append(inter_specials[0])
                    word_indices.append(None)
                    # Queue remaining specials for subsequent segments
                    if num_consumed > 1:
                        pending_specials = list(inter_specials[1:])
                        skip_count = num_consumed - 1

                    continue
                else:
                    is_first_after_transition = True
                    # No specials — re-try alignment on this segment against the new chapter
                    alignment, timing = align_segment(asr_phonemes, chapter_ref, pointer, segment_idx)
                    num_segments += 1
                    if PHONEME_ALIGNMENT_PROFILING:
                        dp_times.append(timing['dp_time'])
                        window_setup_total += timing['window_setup_time']
                        result_build_total += timing['result_build_time']
                    # Fall through to existing if/else below

        # Basmala-fused retry: if this is the first segment after a transition
        # and Basmala wasn't detected, the reciter may have merged Basmala with
        # the first verse. Always try prepending Basmala phonemes to R and pick
        # the better result (even if the plain alignment already succeeded).
        if is_first_after_transition:
            is_first_after_transition = False

            basmala_alignment, basmala_timing = align_segment(
                asr_phonemes, chapter_ref, pointer, segment_idx,
                basmala_prefix=True)
            num_segments += 1
            if PHONEME_ALIGNMENT_PROFILING:
                dp_times.append(basmala_timing['dp_time'])
                window_setup_total += basmala_timing['window_setup_time']
                result_build_total += basmala_timing['result_build_time']

            if basmala_alignment and basmala_alignment.basmala_consumed:
                existing_conf = alignment.confidence if alignment else 0.0
                if basmala_alignment.confidence > existing_conf:
                    matched_text = SPECIAL_TEXT["Basmala"] + " " + get_matched_text(chapter_ref, basmala_alignment)
                    result = (matched_text, basmala_alignment.confidence, basmala_alignment.matched_ref)
                    pointer = basmala_alignment.end_word_idx + 1
                    consecutive_failures = 0
                    word_indices.append((basmala_alignment.start_word_idx, basmala_alignment.end_word_idx))
                    _check_transition_gap(basmala_alignment.start_word_idx)
                    results.append(result)
                    special_merges += 1
                    segments_passed += 1
                    print(f"  [BASMALA-FUSED] Segment {segment_idx}: Basmala merged with verse "
                          f"(fused conf={basmala_alignment.confidence:.2f} > plain conf={existing_conf:.2f})")
                    continue
            # Basmala-fused didn't win — fall through with original alignment

        if alignment:
            is_first_after_transition = False
            matched_text = get_matched_text(chapter_ref, alignment)
            result = (matched_text, alignment.confidence, alignment.matched_ref)
            pointer = alignment.end_word_idx + 1  # Advance pointer
            consecutive_failures = 0
            word_indices.append((alignment.start_word_idx, alignment.end_word_idx))
            _check_transition_gap(alignment.start_word_idx)
            segments_passed += 1
        else:
            # === Check for transition segment before retry tiers ===
            trans_name, trans_conf = detect_transition_segment(asr_phonemes)
            if trans_name:
                print(f"  [TRANSITION] Segment {segment_idx}: {trans_name} (conf={trans_conf:.2f})")
                result = (TRANSITION_TEXT[trans_name], trans_conf, trans_name)
                word_indices.append(None)
                transition_skips += 1
                transition_mode = True

                # Tahmeed peek-ahead for merge
                if trans_name == "Tahmeed":
                    next_abs = first_quran_idx + i + 1
                    if next_abs < len(phoneme_texts) and phoneme_texts[next_abs]:
                        resp_name, resp_conf = detect_transition_segment(
                            phoneme_texts[next_abs], allowed={"Tahmeed"})
                        if resp_name:
                            merged_into[next_abs] = first_quran_idx + i
                            tahmeed_merge_skip = 1
                            print(f"  [TAHMEED-MERGE] Next segment merged into Tahmeed")

                results.append(result)
                continue

            # === Graduated retry ===
            # Tier 1: expanded window, same threshold
            tier1_attempts += 1
            tier1_segments.append(segment_idx)
            alignment, timing = align_segment(
                asr_phonemes, chapter_ref, pointer, segment_idx,
                lookback_override=RETRY_LOOKBACK_WORDS,
                lookahead_override=RETRY_LOOKAHEAD_WORDS,
            )
            num_segments += 1
            if PHONEME_ALIGNMENT_PROFILING:
                dp_times.append(timing['dp_time'])
                window_setup_total += timing['window_setup_time']
                result_build_total += timing['result_build_time']

            # Tier 2: expanded window + relaxed threshold
            tier2_entered = False
            if alignment is None:
                tier2_entered = True
                tier2_attempts += 1
                tier2_segments.append(segment_idx)
                alignment, timing = align_segment(
                    asr_phonemes, chapter_ref, pointer, segment_idx,
                    lookback_override=RETRY_LOOKBACK_WORDS,
                    lookahead_override=RETRY_LOOKAHEAD_WORDS,
                    max_edit_distance_override=MAX_EDIT_DISTANCE_RELAXED,
                )
                num_segments += 1
                if PHONEME_ALIGNMENT_PROFILING:
                    dp_times.append(timing['dp_time'])
                    window_setup_total += timing['window_setup_time']
                    result_build_total += timing['result_build_time']

            if alignment:
                # Retry succeeded
                is_first_after_transition = False
                matched_text = get_matched_text(chapter_ref, alignment)
                result = (matched_text, alignment.confidence, alignment.matched_ref)
                pointer = alignment.end_word_idx + 1
                consecutive_failures = 0
                word_indices.append((alignment.start_word_idx, alignment.end_word_idx))
                _check_transition_gap(alignment.start_word_idx)
                segments_passed += 1
                if tier2_entered:
                    tier2_passed += 1
                else:
                    tier1_passed += 1
                print(f"  [RETRY-OK] Segment {segment_idx}: recovered via expanded window/relaxed threshold")
            else:
                # Real failure after all retries
                result = ("", 0.0, "")
                consecutive_failures += 1
                word_indices.append(None)

                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    consec_reanchors += 1
                    # Global re-anchor (not constrained to current surah)
                    remaining_idx = first_quran_idx + i + 1
                    remaining_texts = phoneme_texts[remaining_idx:]
                    if remaining_texts:
                        reanchor_surah, reanchor_ayah = find_anchor_by_voting(
                            remaining_texts, get_ngram_index(), ANCHOR_SEGMENTS,
                        )
                        if reanchor_surah > 0:
                            if reanchor_surah != detected_surah:
                                detected_surah = reanchor_surah
                                chapter_ref = get_chapter_reference(detected_surah)
                            pointer = verse_to_word_index(chapter_ref, reanchor_ayah)
                            transition_expected_pointer = pointer
                            print(f"  [GLOBAL-REANCHOR] Jumped to Surah {detected_surah}, "
                                  f"Ayah {reanchor_ayah}, word {pointer}")
                    consecutive_failures = 0

        results.append(result)

    # Post-processing: detect consecutive segments with reference gaps
    # (gap_segments may already have entries from chapter-transition checks above)
    prev_matched_idx = None
    for idx in range(len(results)):
        if word_indices[idx] is None:
            continue

        if prev_matched_idx is not None:
            # Skip gap check across chapter transitions — word indices are per-chapter
            prev_ref = results[prev_matched_idx][2]
            curr_ref = results[idx][2]
            prev_surah = prev_ref.split(":")[0] if prev_ref and ":" in prev_ref else None
            curr_surah = curr_ref.split(":")[0] if curr_ref and ":" in curr_ref else None

            if prev_surah is not None and prev_surah == curr_surah:
                prev_end = word_indices[prev_matched_idx][1]
                curr_start = word_indices[idx][0]
                gap = curr_start - prev_end - 1

                if gap > 0:
                    gap_segments.add(prev_matched_idx)
                    gap_segments.add(idx)

                    print(f"  [GAP] {gap} word(s) missing between segments "
                          f"{prev_matched_idx + 1} and {idx + 1}")

        prev_matched_idx = idx

    # Edge case: missing words at start of expected range
    first_matched = next((i for i, w in enumerate(word_indices) if w is not None), None)
    if first_matched is not None:
        first_start = word_indices[first_matched][0]
        if first_start > start_pointer:
            gap_segments.add(first_matched)
            print(f"  [GAP] {first_start - start_pointer} word(s) missing before first segment {first_matched + 1}")

    # Edge case: missing words at end of current verse
    # Only flag if the last matched segment is also the final segment overall.
    # If there are trailing no-match segments after it, those account for the
    # remaining audio — the words aren't missing, they just failed to align.
    # Compare against the verse boundary (not chapter end), since a recitation
    # doesn't necessarily cover the entire chapter.
    last_matched = next((i for i in range(len(word_indices) - 1, -1, -1) if word_indices[i] is not None), None)
    if last_matched is not None and last_matched == len(word_indices) - 1:
        last_end = word_indices[last_matched][1]
        last_ayah = chapter_ref.words[last_end].ayah
        # Find the last word index that belongs to the same verse
        verse_end = last_end
        while verse_end + 1 < chapter_ref.num_words and chapter_ref.words[verse_end + 1].ayah == last_ayah:
            verse_end += 1
        if last_end < verse_end:
            gap_segments.add(last_matched)
            print(f"  [GAP] {verse_end - last_end} word(s) missing after last segment {last_matched + 1}")

    # Build profiling dict
    if PHONEME_ALIGNMENT_PROFILING:
        total_time = time.perf_counter() - total_start
        profiling = {
            "total_time": total_time,
            "ref_build_time": ref_build_time,
            "dp_total_time": sum(dp_times),
            "dp_min_time": min(dp_times) if dp_times else 0.0,
            "dp_max_time": max(dp_times) if dp_times else 0.0,
            "window_setup_time": window_setup_total,
            "result_build_time": result_build_total,
            "num_segments": num_segments,
            "tier1_attempts": tier1_attempts,
            "tier1_passed": tier1_passed,
            "tier1_segments": tier1_segments,
            "tier2_attempts": tier2_attempts,
            "tier2_passed": tier2_passed,
            "tier2_segments": tier2_segments,
            "consec_reanchors": consec_reanchors,
            "segments_attempted": segments_attempted,
            "segments_passed": segments_passed,
            "special_merges": special_merges,
            "transition_skips": transition_skips,
        }
    else:
        profiling = {
            "num_segments": num_segments,
            "tier1_attempts": tier1_attempts,
            "tier1_passed": tier1_passed,
            "tier1_segments": tier1_segments,
            "tier2_attempts": tier2_attempts,
            "tier2_passed": tier2_passed,
            "tier2_segments": tier2_segments,
            "consec_reanchors": consec_reanchors,
            "segments_attempted": segments_attempted,
            "segments_passed": segments_passed,
            "special_merges": special_merges,
            "transition_skips": transition_skips,
        }

    return results, profiling, gap_segments, merged_into
