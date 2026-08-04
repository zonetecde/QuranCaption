"""Post-ASR Matcher (SDK Text Alignment)."""

import time
from collections import defaultdict
from difflib import SequenceMatcher

import numpy as np
from qua_sdk.schemas import Region, Regions, Emissions, Alignment, AlignedSegment
from qua_sdk.components.matching.runtimes.wraparound_params import WraparoundDpParams
from qua_sdk.components.matching.runtimes.sequencer import run_matching_sequence
from qua_sdk.components.matching.runtimes.runtime import find_anchor_by_voting
from src.phase2_matching.normalize import get_arabic_resources, normalize_arabic
from src.core import sdk_adapt


def _chapter_scores(tokens, ngram_index) -> dict[int, float]:
    """Returns weighted n-gram votes grouped by chapter."""
    scores: dict[int, float] = defaultdict(float)
    ngram_size = ngram_index.ngram_size
    for index in range(len(tokens) - ngram_size + 1):
        ngram = tuple(tokens[index:index + ngram_size])
        count = ngram_index.ngram_counts.get(ngram)
        if not count:
            continue
        for surah, _ayah in ngram_index.ngram_positions[ngram]:
            scores[surah] += 1.0 / count
    return scores


def _chapter_start_ayah(tokens, surah: int, resources, fallback: int) -> int:
    """Returns the best matching ayah inside a known chapter."""
    scores: dict[int, float] = defaultdict(float)
    ngram_index = resources.ngram_index
    ngram_size = ngram_index.ngram_size
    for index in range(len(tokens) - ngram_size + 1):
        ngram = tuple(tokens[index:index + ngram_size])
        count = ngram_index.ngram_counts.get(ngram)
        if not count:
            continue
        for candidate_surah, ayah in ngram_index.ngram_positions[ngram]:
            if candidate_surah == surah:
                scores[ayah] += 1.0 / count
    query = "".join(tokens).strip()
    ayah_tokens: dict[int, list[str]] = defaultdict(list)
    for word in resources.chapter_refs[surah].words:
        ayah_tokens[word.ayah].extend(word.phonemes)
    similarities = {
        ayah: SequenceMatcher(
            None, query, "".join(reference), autojunk=False
        ).find_longest_match().size / max(1, len(query))
        for ayah, reference in ayah_tokens.items()
    }
    if similarities and max(similarities.values()) >= 0.5:
        return max(similarities, key=similarities.get)
    return max(scores, key=scores.get) if scores else fallback


def _chapter_similarity(tokens, chapter_ref) -> float:
    """Returns the longest normalized character match ratio for one chapter."""
    query = "".join(tokens).strip()
    reference = "".join(phoneme for word in chapter_ref.words for phoneme in word.phonemes)
    if not query or not reference:
        return 0.0
    match = SequenceMatcher(None, query, reference, autojunk=False).find_longest_match()
    return match.size / len(query)


def _tokens_from_words(words: list[dict]) -> list[str]:
    """Builds normalized matcher tokens from timestamped ASR words."""
    text = " ".join(word.get("word", "") for word in words)
    return list(normalize_arabic(text)) + [" "]


def _chapter_word_index(text: str, chapter_ref) -> int | None:
    """Returns the closest canonical chapter word index for one ASR word."""
    query = "".join(_tokens_from_words([{"word": text}])).strip()
    if not query:
        return None
    matches = [
        SequenceMatcher(
            None, query, "".join(word.phonemes).strip(), autojunk=False
        ).ratio()
        for word in chapter_ref.words
    ]
    best_index = max(range(len(matches)), key=matches.__getitem__)
    return best_index if matches[best_index] >= 0.5 else None


def _slice_logprobs(logprobs, chunk_start_s: float, start_s: float, end_s: float):
    """Slices FastConformer emissions to one timestamped word group."""
    if logprobs is None:
        return None, start_s
    start_frame = max(0, int((start_s - chunk_start_s) * 12.5))
    end_frame = max(start_frame + 1, int(np.ceil((end_s - chunk_start_s) * 12.5)))
    if logprobs.ndim == 3:
        return logprobs[:, start_frame:end_frame, :], chunk_start_s + start_frame / 12.5
    return logprobs[start_frame:end_frame], chunk_start_s + start_frame / 12.5


def _prepare_multi_chapter_units(
    audio, sample_rate, regions, emissions, stage_metrics, resources, params
):
    """Splits cross-chapter ASR chunks and labels every chunk with its chapter."""
    anchors = [
        find_anchor_by_voting([tokens], resources.ngram_index, params.anchor)
        for tokens in emissions.tokens
    ]
    if len({surah for surah, _ayah in anchors if surah > 0}) <= 1:
        return None

    asr_words_list = stage_metrics.get("asr_words", [])
    logprobs_list = stage_metrics.get("logprobs", [])
    split_points: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    recovered_units = []

    for index in range(len(anchors) - 1):
        current_surah = anchors[index][0]
        next_surah = anchors[index + 1][0]
        if current_surah <= 0 or next_surah <= 0 or current_surah == next_surah:
            continue

        candidates = []
        for chunk_index in (index, index + 1):
            if chunk_index >= len(asr_words_list):
                continue
            entry = asr_words_list[chunk_index]
            words = entry[0] if isinstance(entry, tuple) else entry
            if not words or len(words) < 2:
                continue
            for word_index in range(1, len(words)):
                if word_index < 3 or len(words) - word_index < 3:
                    continue
                gap = words[word_index]["start"] - words[word_index - 1]["end"]
                if gap < 0.5:
                    continue
                prefix_scores = _chapter_scores(
                    _tokens_from_words(words[:word_index]), resources.ngram_index
                )
                suffix_scores = _chapter_scores(
                    _tokens_from_words(words[word_index:]), resources.ngram_index
                )
                prefix_tokens = _tokens_from_words(words[:word_index])
                suffix_tokens = _tokens_from_words(words[word_index:])
                prefix_similarity = _chapter_similarity(
                    prefix_tokens, resources.chapter_refs[current_surah]
                )
                suffix_similarity = _chapter_similarity(
                    suffix_tokens, resources.chapter_refs[next_surah]
                )
                prefix_matches = prefix_scores.get(current_surah, 0.0) or prefix_similarity >= 0.35
                suffix_matches = suffix_scores.get(next_surah, 0.0) or suffix_similarity >= 0.35
                if prefix_matches and suffix_matches:
                    candidates.append(
                        (prefix_similarity + suffix_similarity, gap, chunk_index, word_index)
                    )

        if candidates:
            _score, _gap, chunk_index, word_index = max(candidates)
            split_points[chunk_index].append((word_index, current_surah, next_surah))

    refinement_candidates = []
    for chunk_index, ((surah, _ayah), entry) in enumerate(zip(anchors, asr_words_list)):
        if surah <= 0:
            continue
        words = entry[0] if isinstance(entry, tuple) else entry
        covered_ranges = []
        for current_index in range(1, len(words or [])):
            gap = words[current_index]["start"] - words[current_index - 1]["end"]
            if gap < 0.5:
                continue
            current_text = normalize_arabic(words[current_index]["word"]).strip()
            previous_indices = [
                previous_index
                for previous_index in range(max(0, current_index - 12), current_index - 1)
                if normalize_arabic(words[previous_index]["word"]).strip() == current_text
                and words[current_index]["start"] - words[previous_index]["start"] <= 15.0
            ]
            if previous_indices:
                start_index = previous_indices[-1]
                refinement_candidates.append((
                    chunk_index, start_index, current_index, surah, "repetition"
                ))
                covered_ranges.append((start_index, current_index))
        for word_index, word in enumerate(words or []):
            if word["end"] - word["start"] < 2.0 or any(
                start <= word_index < end for start, end in covered_ranges
            ):
                continue
            refinement_candidates.append((
                chunk_index, word_index, word_index + 1, surah, "collapsed"
            ))

    audio_pcm = None
    model = None
    refinements: dict[int, list[tuple[int, int, list[dict]]]] = defaultdict(list)
    if refinement_candidates:
        import librosa
        from src.phase1_transcribe.fastconformer import FastConformerONNX

        if isinstance(audio, str):
            audio_pcm, _ = librosa.load(audio, sr=sample_rate, mono=True)
        else:
            audio_pcm = np.asarray(audio, dtype=np.float32)
        model = FastConformerONNX.get_instance(device="cpu")

        for chunk_index, start_index, end_index, surah, kind in refinement_candidates:
            if any(
                start_index < accepted_end and accepted_start < end_index
                for accepted_start, accepted_end, _words in refinements[chunk_index]
            ):
                continue
            entry = asr_words_list[chunk_index]
            words = entry[0] if isinstance(entry, tuple) else entry
            source_words = words[start_index:end_index]
            slice_start = max(0.0, source_words[0]["start"] - 0.2)
            slice_end = min(
                len(audio_pcm) / sample_rate,
                (
                    words[end_index]["start"] - 0.05
                    if kind == "repetition"
                    else source_words[-1]["end"] + 0.2
                ),
            )
            _text, replacement_words, _logprobs = model.transcribe(
                audio_pcm[int(slice_start * sample_rate):int(slice_end * sample_rate)],
                orig_sr=sample_rate,
                safe_lufs=True,
            )
            for word in replacement_words or []:
                word["start"] += slice_start
                word["end"] += slice_start
            replacement_tokens = _tokens_from_words(replacement_words or [])
            minimum_words = len(source_words) + 1 if kind == "repetition" else 2
            if (
                len(replacement_words or []) < minimum_words
                or (
                    kind == "repetition"
                    and normalize_arabic(replacement_words[0]["word"]).strip()
                    != normalize_arabic(source_words[0]["word"]).strip()
                )
                or not _chapter_scores(
                    replacement_tokens, resources.ngram_index
                ).get(surah, 0.0)
            ):
                continue
            refinements[chunk_index].append(
                (start_index, end_index, replacement_words)
            )

    for chunk_index, replacements in refinements.items():
        entry = asr_words_list[chunk_index]
        words = entry[0] if isinstance(entry, tuple) else entry
        points = split_points.get(chunk_index, [])
        split_points[chunk_index] = [
            (
                point + sum(
                    len(replacement_words) - (end_index - start_index)
                    for start_index, end_index, replacement_words in replacements
                    if end_index <= point
                ),
                before_surah,
                after_surah,
            )
            for point, before_surah, after_surah in points
        ]
        for start_index, end_index, replacement_words in sorted(
            replacements, key=lambda replacement: replacement[0], reverse=True
        ):
            words[start_index:end_index] = replacement_words
        emissions.tokens[chunk_index] = _tokens_from_words(words)
        anchors[chunk_index] = find_anchor_by_voting(
            [emissions.tokens[chunk_index]], resources.ngram_index, params.anchor
        )

    timestamped_words = []
    for chunk_index, entry in enumerate(asr_words_list):
        words = entry[0] if isinstance(entry, tuple) else entry
        for word_index, word in enumerate(words or []):
            timestamped_words.append((word["start"], chunk_index, word_index, word))
    timestamped_words.sort()

    recovery_gaps = []
    for previous, current in zip(timestamped_words, timestamped_words[1:]):
        gap_start = previous[3]["end"]
        gap_end = current[3]["start"]
        if gap_end - gap_start >= 2.5:
            recovery_gaps.append((gap_start, gap_end, previous, current))

    if recovery_gaps:
        if model is None:
            import librosa
            from src.phase1_transcribe.fastconformer import FastConformerONNX

            if isinstance(audio, str):
                audio_pcm, _ = librosa.load(audio, sr=sample_rate, mono=True)
            else:
                audio_pcm = np.asarray(audio, dtype=np.float32)
            model = FastConformerONNX.get_instance(device="cpu")

        for gap_start, gap_end, previous, current in recovery_gaps:
            slice_start = max(0.0, gap_start - 0.2)
            candidate_surahs = {
                anchors[previous[1]][0],
                anchors[current[1]][0],
            } - {0}
            recovered_words = None
            recovered_tokens = None
            recovered_logprobs = None
            matched_surahs = []
            for slice_end in (
                min(len(audio_pcm) / sample_rate, gap_end + 3.0),
                gap_end,
            ):
                _text, candidate_words, candidate_logprobs = model.transcribe(
                    audio_pcm[int(slice_start * sample_rate):int(slice_end * sample_rate)],
                    orig_sr=sample_rate,
                    safe_lufs=True,
                )
                for word in candidate_words or []:
                    word["start"] += slice_start
                    word["end"] += slice_start
                candidate_words = [
                    word
                    for word in (candidate_words or [])
                    if word["start"] >= gap_start and word["end"] <= gap_end
                ]
                candidate_tokens = _tokens_from_words(candidate_words)
                matched_surahs = [
                    surah
                    for surah in candidate_surahs
                    if _chapter_scores(candidate_tokens, resources.ngram_index).get(surah, 0.0)
                    or (
                        len("".join(candidate_tokens).strip()) >= 6
                        and _chapter_similarity(
                            candidate_tokens, resources.chapter_refs[surah]
                        ) >= 0.5
                    )
                ]
                if matched_surahs:
                    recovered_words = candidate_words
                    recovered_tokens = candidate_tokens
                    recovered_logprobs = candidate_logprobs
                    break
            if not matched_surahs:
                continue
            recovered_surah = max(
                matched_surahs,
                key=lambda surah: _chapter_scores(
                    recovered_tokens, resources.ngram_index
                ).get(surah, 0.0),
            )
            recovered_start = recovered_words[0]["start"]
            recovered_end = recovered_words[-1]["end"]
            sliced_logprobs, sliced_start = _slice_logprobs(
                recovered_logprobs,
                slice_start,
                recovered_start,
                recovered_end,
            )
            recovered_units.append((
                Region(start_s=recovered_start, end_s=recovered_end),
                recovered_tokens,
                (recovered_surah, 1),
                (recovered_words, sliced_start),
                (sliced_logprobs, sliced_start),
            ))
            if previous[1] == current[1]:
                split_points[previous[1]].append(
                    (current[2], recovered_surah, recovered_surah)
                )
                source_entry = asr_words_list[previous[1]]
                source_words = source_entry[0] if isinstance(source_entry, tuple) else source_entry
                chapter_ref = resources.chapter_refs[recovered_surah]
                for word_index in range(current[2] + 1, len(source_words)):
                    previous_index = _chapter_word_index(
                        source_words[word_index - 1]["word"], chapter_ref
                    )
                    current_index = _chapter_word_index(
                        source_words[word_index]["word"], chapter_ref
                    )
                    gap = (
                        source_words[word_index]["start"]
                        - source_words[word_index - 1]["end"]
                    )
                    if (
                        previous_index is not None
                        and current_index is not None
                        and previous_index - current_index >= 2
                        and gap >= 0.5
                    ):
                        split_points[previous[1]].append(
                            (word_index, recovered_surah, recovered_surah)
                        )
                        break

    unit_regions = []
    unit_tokens = []
    unit_labels = []
    unit_asr_words = []
    unit_logprobs = []

    for chunk_index, (region, tokens, anchor) in enumerate(
        zip(regions.regions, emissions.tokens, anchors)
    ):
        points = sorted(
            {point[0]: point for point in split_points.get(chunk_index, [])}.values()
        )
        if not points or chunk_index >= len(asr_words_list) or chunk_index >= len(logprobs_list):
            unit_regions.append(region)
            unit_tokens.append(tokens)
            unit_labels.append(anchor)
            if chunk_index < len(asr_words_list):
                unit_asr_words.append(asr_words_list[chunk_index])
            if chunk_index < len(logprobs_list):
                unit_logprobs.append(logprobs_list[chunk_index])
            continue

        asr_entry = asr_words_list[chunk_index]
        words = asr_entry[0] if isinstance(asr_entry, tuple) else asr_entry
        logprobs_entry = logprobs_list[chunk_index]
        if isinstance(logprobs_entry, tuple):
            logprobs, chunk_start_s = logprobs_entry
        else:
            logprobs, chunk_start_s = logprobs_entry, region.start_s

        boundaries = [0] + [point[0] for point in points] + [len(words)]
        labels = [points[0][1]] + [point[2] for point in points]
        for unit_index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
            group = words[start:end]
            if not group:
                continue
            unit_start = group[0]["start"]
            unit_end = group[-1]["end"]
            sliced_logprobs, sliced_start = _slice_logprobs(
                logprobs, chunk_start_s, unit_start, unit_end
            )
            unit_regions.append(Region(start_s=unit_start, end_s=unit_end))
            unit_tokens.append(_tokens_from_words(group))
            unit_surah = labels[unit_index]
            unit_labels.append((
                unit_surah,
                anchor[1] if unit_surah == anchor[0] else 1,
            ))
            unit_asr_words.append((group, sliced_start))
            unit_logprobs.append((sliced_logprobs, sliced_start))

    units = list(zip(
        unit_regions,
        unit_tokens,
        unit_labels,
        unit_asr_words,
        unit_logprobs,
    ))
    units.extend(recovered_units)
    units.sort(key=lambda unit: unit[0].start_s)
    (
        unit_regions,
        unit_tokens,
        unit_labels,
        unit_asr_words,
        unit_logprobs,
    ) = map(
        list, zip(*units)
    )

    stage_metrics["asr_words"] = unit_asr_words
    stage_metrics["logprobs"] = unit_logprobs
    stage_metrics["multi_chapter"] = True
    return (
        Regions(regions=unit_regions, audio_duration_s=regions.audio_duration_s),
        Emissions(tokens=unit_tokens),
        stage_metrics,
        unit_labels,
    )


def _run_post_asr_pipeline(
    audio,
    sample_rate,
    intervals,
    model_name,
    profiling,
    pipeline_start,
    regions=None,
    emissions=None,
    stage_metrics=None
):
    """Main orchestration function for Phase 2 (SDK Text Matching)."""
    if not intervals:
        return {}, []

    if regions is None:
        duration = len(audio) / sample_rate if not isinstance(audio, str) else 0.0
        regions = Regions(
            regions=[Region(start_s=float(s), end_s=float(e)) for s, e in intervals],
            audio_duration_s=duration,
        )

    transcribed_tokens = emissions.tokens
    match_start = time.time()

    try:
        resources = get_arabic_resources()
        params = WraparoundDpParams()
        from qua_sdk.components.matching.runtimes.runtime import detect_opening_specials

        special_hits, first_quran_idx = detect_opening_specials(
            transcribed_tokens,
            resources.templates,
            max_special_edit_distance=params.specials.max_special_edit_distance,
            max_transition_edit_distance=params.specials.max_transition_edit_distance,
        )

        prepared = _prepare_multi_chapter_units(
            audio, sample_rate, regions, emissions, stage_metrics, resources, params
        )
        if prepared is None:
            quran_tokens = transcribed_tokens[first_quran_idx:] if first_quran_idx < len(transcribed_tokens) else transcribed_tokens
            start_surah, start_ayah = find_anchor_by_voting(quran_tokens, resources.ngram_index, params.anchor)
            if start_surah <= 0:
                start_surah, start_ayah = find_anchor_by_voting(transcribed_tokens, resources.ngram_index, params.anchor)
                if start_surah <= 0:
                    raise ValueError("Could not anchor to any chapter — no n-gram matches found")

            chapter_ref = resources.chapter_refs[start_surah]
            start_pointer = 0
            for i, w in enumerate(chapter_ref.words):
                if w.ayah == start_ayah:
                    start_pointer = i
                    break

            sdk_result = run_matching_sequence(
                phoneme_texts=transcribed_tokens,
                start_surah=start_surah,
                first_quran_idx=first_quran_idx,
                special_results=special_hits,
                start_pointer=start_pointer,
                params=params,
                resources=resources,
            )
            match_results = sdk_result.results
            match_metrics = sdk_result.metrics
            gap_events = sdk_result.events
        else:
            regions, emissions, stage_metrics, unit_labels = prepared
            transcribed_tokens = emissions.tokens
            match_results = []
            match_metrics: dict[str, int | float] = defaultdict(int)
            gap_events = []
            start_surah = unit_labels[0][0]

            unit_index = 0
            while unit_index < len(transcribed_tokens):
                unit_surah, fallback_ayah = unit_labels[unit_index]
                if unit_surah <= 0:
                    match_results.append(("", 0.0, "", None))
                    unit_index += 1
                    continue
                group_end = unit_index + 1
                while (
                    group_end < len(unit_labels)
                    and unit_labels[group_end][0] == unit_surah
                ):
                    group_end += 1
                group_tokens = transcribed_tokens[unit_index:group_end]
                unit_ayah = _chapter_start_ayah(
                    group_tokens[0], unit_surah, resources, fallback_ayah
                )
                start_ayah = max(1, unit_ayah - 3)
                chapter_ref = resources.chapter_refs[unit_surah]
                start_pointer = next(
                    (i for i, word in enumerate(chapter_ref.words) if word.ayah == start_ayah),
                    0,
                )
                unit_result = run_matching_sequence(
                    phoneme_texts=group_tokens,
                    start_surah=unit_surah,
                    start_pointer=start_pointer,
                    params=params,
                    resources=resources,
                )
                match_results.extend(unit_result.results)
                gap_events.extend(unit_result.events)
                for key, value in unit_result.metrics.items():
                    if isinstance(value, (int, float)):
                        match_metrics[key] += value
                unit_index = group_end

    except Exception as e:
        user_message = getattr(e, "user_message", None)
        if user_message:
            raise ValueError(user_message) from e
        raise

    match_time = time.time() - match_start
    profiling.match_wall_time = match_time
    sdk_adapt.metrics_to_profiling({"matching": match_metrics}, profiling)

    alignment = Alignment(chapter=start_surah, segments=[])

    for i, res in enumerate(match_results):
        if len(res) == 4:
            matched_text, score, matched_ref, wrap_ranges = res
        else:
            matched_text, score, matched_ref = res
            wrap_ranges = None

        if wrap_ranges and matched_ref and ":" in matched_ref:
            from src.core.quran_index import get_quran_index
            qi = get_quran_index()

            parts = matched_ref.split("-")
            ref_from = parts[0]
            ref_to = parts[1] if len(parts) > 1 else parts[0]

            sections = []
            if len(wrap_ranges[0]) >= 3:
                sections.append([ref_from, wrap_ranges[0][1]])
                for wr in wrap_ranges:
                    sections.append([wr[0], wr[2]])
            else:
                sections.append([ref_from, wrap_ranges[0][1]])
                for i_wr in range(len(wrap_ranges) - 1):
                    sections.append([wrap_ranges[i_wr][0], wrap_ranges[i_wr + 1][1]])
                sections.append([wrap_ranges[-1][0], ref_to])

            recited_words = []
            for s_ref, e_ref in sections:
                indices = qi.ref_to_indices(f"{s_ref}-{e_ref}")
                if indices:
                    s, e = indices
                    recited_words.extend(qi.words[gi].text for gi in range(s, e + 1))

            if recited_words:
                canon_indices = qi.ref_to_indices(matched_ref)
                if canon_indices:
                    canon_count = canon_indices[1] - canon_indices[0] + 1
                    orig_words = matched_text.split()
                    if len(orig_words) > canon_count:
                        prefix_words = orig_words[:len(orig_words) - canon_count]
                        recited_words = prefix_words + recited_words
                matched_text = " ".join(recited_words)

        # Match reference project: only flag score==0 as low-confidence.
        # Low-but-nonzero scores (< 20%) are accepted silently like the reference.
        seg = AlignedSegment(
            id=i,
            region=regions.regions[i],
            matched_text=matched_text,
            matched_ref=matched_ref,
            confidence=score,
            wrap_word_ranges=wrap_ranges,
            error="Low confidence (0%)" if score == 0 else None,
        )
        alignment.segments.append(seg)

    # alignment_to_segment_infos already sets has_repeated_words from wrap_word_ranges.
    # Do NOT overwrite it — the wrap_ranges are the single source of truth.
    segments = sdk_adapt.alignment_to_segment_infos(alignment, emissions, regions)

    gap_events = [e for e in gap_events if isinstance(e, dict) and e.get("event") == "gap"]
    for seg_info in segments:
        seg_info._gap_events = gap_events

    profiling.segments_attempted = len(segments)
    profiling.segments_passed = sum(1 for s in segments if s.match_score > 0.0)
    profiling.total_time = time.time() - pipeline_start

    return None, segments
