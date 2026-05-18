"""
Service for matching transcribed words to reference ayahs.
"""

import re
import numpy as np
from pathlib import Path
from typing import List, Optional, Tuple

from surah_splitter.utils.app_logger import logger
from surah_splitter.models.all_models import (
    MatchedAyahsAndSpans,
    RecognizedSentencesAndWords,
    RecognizedWord,
    ReferenceWord,
    SegmentedWordSpan,
    AyahTimestamp,
)
from surah_splitter.utils.file_utils import save_json


class AyahMatchingService:
    """Service for matching transcribed words to reference ayahs."""

    def __init__(self):
        pass

    def match_ayahs(
        self,
        transcription_result: RecognizedSentencesAndWords,
        reference_ayahs: List[str],
        ayah_numbers: Optional[list[int]] = None,
        output_dir: Optional[Path] = None,
        save_intermediates: bool = False,
    ) -> MatchedAyahsAndSpans:
        """
        Match transcribed words to reference ayahs.

        This method aligns the recognized words from the transcription result
        with the reference ayahs for the specified surah.

        Args:
            transcription_result: Transcription result from the TranscriptionService.
            reference_ayahs: List of reference ayah texts.
            ayah_numbers: Optional list of specific ayahs to match.
            output_dir: Directory to save intermediate files.
            save_intermediates: Whether to save intermediate files.

        Returns:
            A dictionary containing ayah timestamps and alignment information.
        """
        logger.info(f"Matching transcribed words to {len(reference_ayahs)} reference ayahs")

        # Extract recognized words from transcription
        recognized_words = self._extract_recognized_words(transcription_result)
        logger.debug(f"Extracted {len(recognized_words)} recognized words from transcription")

        # Extract reference words
        reference_words = self._extract_reference_words(reference_ayahs, ayah_numbers)
        logger.debug(f"Extracted {len(reference_words)} reference words")

        # Save intermediates if requested
        if save_intermediates and output_dir:
            # Save recognized words
            save_json(
                data=RecognizedWord.list_to_dict_list(recognized_words),
                output_dir=output_dir,
                filename="03_recognized_words.json",
            )
            # Save reference words
            save_json(
                data=ReferenceWord.list_to_dict_list(reference_words),
                output_dir=output_dir,
                filename="04_reference_words.json",
            )

        # Align words (dynamic programming)
        cost_matrix, back_matrix = self._compute_alignment_matrices(recognized_words, reference_words)

        if save_intermediates and output_dir:
            # Also save as JSON for human readability
            save_json(data=cost_matrix.tolist(), output_dir=output_dir, filename="05_cost_matrix.json", indent=4)
            save_json(data=back_matrix.tolist(), output_dir=output_dir, filename="06_back_matrix.json", indent=4)

        # Trace back to get alignment
        alignment_with_ops = self._traceback_alignment(back_matrix)

        if save_intermediates and output_dir:
            # Save alignment indices
            save_json(data=alignment_with_ops, output_dir=output_dir, filename="07_alignment_with_ops.json")

        # Convert alignment indices to word spans
        word_spans = self._convert_to_word_spans(alignment_with_ops, recognized_words, reference_words)

        if save_intermediates and output_dir:  # Save word spans
            save_json(
                data=SegmentedWordSpan.list_to_dict_list(word_spans),
                output_dir=output_dir,
                filename="08_word_spans.json",
            )

        # Extract ayah timestamps
        ayah_timestamps = self._extract_ayah_timestamps(word_spans, reference_words, reference_ayahs)

        # Save ayah timestamps
        if output_dir:
            save_json(
                data=AyahTimestamp.list_to_dict_list(ayah_timestamps),
                output_dir=output_dir,
                filename="09_ayah_timestamps.json" if save_intermediates else "ayah_timestamps.json",
            )
            save_json(
                data=SegmentedWordSpan.list_to_dict_list(
                    word_spans,
                    included_keys=["reference_words_segment", "start", "end"],
                    key_names_mapping={
                        "reference_words_segment": "word",
                    },
                ),
                output_dir=output_dir,
                filename="10_word_timestamps.json" if save_intermediates else "word_timestamps.json",
            )

        logger.success(f"Successfully matched {len(ayah_timestamps)} ayahs")

        return {
            "ayah_timestamps": AyahTimestamp.list_to_dict_list(ayah_timestamps),
            "word_spans": SegmentedWordSpan.list_to_dict_list(word_spans),
        }

    def _extract_recognized_words(self, alignment_result: RecognizedSentencesAndWords) -> List[RecognizedWord]:
        """Extract recognized words from alignment result.

        Args:
            alignment_result: Result from TranscriptionService.transcribe()
                (internally: whisperx.align())

        Returns:
            List of RecognizedWord objects
        """
        word_segments = alignment_result.get("word_segments", [])

        # Clean and prepare words
        recognized_words = []
        for segment in word_segments:
            # Normalize word text
            word = self._clean_word(segment["word"])

            # Skip empty words
            if not word:
                continue

            recognized_words.append(
                RecognizedWord(
                    word=word,
                    start_time=segment["start"],
                    end_time=segment["end"],
                    score=segment.get("score", None),
                )
            )

        return recognized_words

    def _clean_word(self, word: str) -> str:
        """Clean Arabic text by removing diacritics and non-Arabic characters.

        Args:
            word: Input word

        Returns:
            Cleaned word
        """
        # Keep only specified Arabic letters and spaces
        # Check this for details:
        #   https://jrgraphix.net/r/Unicode/0600-06FF
        word = re.sub(r"[^\u060f\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\s]", "", word)

        # Normalize/Trim spaces
        word = re.sub(r"\s+", " ", word).strip()
        return word

    def _extract_reference_words(
        self, reference_ayahs: List[str], ayah_numbers: Optional[List[int]] = None
    ) -> List[ReferenceWord]:
        """Extract words from reference ayahs.

        Args:
            reference_ayahs: List of ayah texts
            ayah_numbers: List of ayah numbers corresponding to the reference ayahs

        Returns:
            List of ReferenceWord objects
        """
        reference_words = []

        for i, ayah_text in enumerate(reference_ayahs):
            if ayah_numbers:
                ayah_idx = ayah_numbers[i]
            else:
                ayah_idx = i + 1  # Ayah numbers are 1-based

            # Split into words and clean
            words = [self._clean_word(w) for w in ayah_text.split()]

            # Filter out empty words
            words = [w for w in words if w]

            # Create ReferenceWord objects
            for word_idx, word in enumerate(words, start=1):
                reference_words.append(
                    ReferenceWord(
                        word=word,
                        ayah_number=ayah_idx,
                        position_wrt_ayah=word_idx,
                        # TODO later: update this logic so that it works with ayah numbers
                        #   instead of just returning -1
                        position_wrt_surah=len(reference_words) + 1 if not ayah_numbers else -1,
                    )
                )

        return reference_words

    def _compute_alignment_matrices(
        self, recognized_words: List[RecognizedWord], reference_words: List[ReferenceWord]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Compute the cost and back matrices for alignment using dynamic programming.

        Args:
            recognized_words: List of recognized words
            reference_words: List of reference words

        Returns:
            Tuple of (cost_matrix, back_matrix)
        """
        # Define matrix dimensions
        n = len(recognized_words) + 1  # +1 for the empty string case
        m = len(reference_words) + 1  # +1 for the empty string case

        # Initialize matrices
        cost_matrix = np.zeros((n, m), dtype=float)
        back_matrix = np.zeros((n, m), dtype=int)

        # Constants for costs
        INSERTION_COST = 1.0
        DELETION_COST = 1.0
        EXACT_MATCH_COST = 0.0
        INEXACT_MATCH_COST = 0.5

        # Initialize first row and column
        for i in range(n):
            cost_matrix[i, 0] = i * INSERTION_COST
            back_matrix[i, 0] = 1  # Insertion (1)

        for j in range(m):
            cost_matrix[0, j] = j * DELETION_COST
            back_matrix[0, j] = 2  # Deletion (2)

        back_matrix[0, 0] = 0  # No operation for (0,0)

        # Fill the matrices
        for i in range(1, n):
            for j in range(1, m):
                rec_word = recognized_words[i - 1].word
                ref_word = reference_words[j - 1].word

                # Calculate costs
                if rec_word == ref_word:
                    # Exact match
                    substitution_cost = EXACT_MATCH_COST
                    operation_type = 3  # Match (3)
                else:
                    # Inexact match - we could refine this with edit distance/similarity
                    substitution_cost = INEXACT_MATCH_COST
                    operation_type = 4  # Substitution (4)

                # Find minimum cost operation
                insertion = cost_matrix[i - 1, j] + INSERTION_COST
                deletion = cost_matrix[i, j - 1] + DELETION_COST
                substitution = cost_matrix[i - 1, j - 1] + substitution_cost

                # Choose the minimum cost operation
                if insertion <= deletion and insertion <= substitution:
                    cost_matrix[i, j] = insertion
                    back_matrix[i, j] = 1  # Insertion
                elif deletion <= insertion and deletion <= substitution:
                    cost_matrix[i, j] = deletion
                    back_matrix[i, j] = 2  # Deletion
                else:
                    cost_matrix[i, j] = substitution
                    back_matrix[i, j] = operation_type  # Match or Substitution

        return cost_matrix, back_matrix

    def _traceback_alignment(self, back_matrix: np.ndarray) -> List[Tuple[int, int, int]]:
        """Trace back through the alignment matrices to get the alignment operations.

        Args:
            back_matrix: The back matrix with operation codes.

        Returns:
            List of (operation, i, j) tuples representing the alignment path.
            operation: 1=INS, 2=DEL, 3=MATCH, 4=SUBST
        """
        i = back_matrix.shape[0] - 1
        j = back_matrix.shape[1] - 1

        alignment = []

        # Trace back from bottom-right to top-left
        while i > 0 or j > 0:
            # Handle case where back_matrix might be empty or have invalid indices
            if i < 0 or j < 0:
                break

            operation = int(back_matrix[i, j])
            alignment.append((operation, i, j))

            if operation == 1:  # Insertion
                i -= 1
            elif operation == 2:  # Deletion
                j -= 1
            else:  # Match or Substitution
                i -= 1
                j -= 1

        # Reverse to get the alignment in the correct order
        alignment.reverse()

        return alignment

    def _convert_to_word_spans(
        self,
        alignment_with_ops: List[Tuple[int, int, int]],
        recognized_words: List[RecognizedWord],
        reference_words: List[ReferenceWord],
        previous_ayahs_to_match: int = 0,
    ) -> List[SegmentedWordSpan]:
        """Convert alignment operations to word spans, with look-back for repeated words.

        Args:
            alignment_with_ops: List of (operation, i, j) tuples from traceback.
            recognized_words: List of recognized words.
            reference_words: List of reference words.
            previous_ayahs_to_match: How many previous ayahs to search for rematches, where:
            * `-1` means we assume the reciter is not repeating words, so no rematches are needed.
            * `0` means search for rematches in the current ayah only.
            * `1` means search for rematches in the current and previous ayah, and so on

        Returns:
            List of SegmentedWordSpan objects.
        """
        word_spans = []
        last_match_ref_idx = -1

        for operation, i, j in alignment_with_ops:
            if operation in [3, 4]:  # Match or Substitution
                ref_index = j - 1
                rec_index = i - 1
                last_match_ref_idx = ref_index

                ref_word_obj = reference_words[ref_index]
                rec_word_obj = recognized_words[rec_index]

                is_exact = operation == 3

                flags = SegmentedWordSpan.MATCHED_INPUT | SegmentedWordSpan.MATCHED_REFERENCE
                flags |= SegmentedWordSpan.EXACT if is_exact else SegmentedWordSpan.INEXACT

                word_spans.append(
                    SegmentedWordSpan(
                        reference_index_start=ref_index,
                        reference_index_end=ref_index + 1,
                        reference_words_segment=ref_word_obj.word,
                        input_words_segment=rec_word_obj.word,
                        start=rec_word_obj.start_time,
                        end=rec_word_obj.end_time,
                        flags=flags,
                        flags_info={
                            "matched_input": True,
                            "matched_reference": True,
                            "exact": is_exact,
                            "inexact": not is_exact,
                        },
                    )
                )
            elif operation == 1:  # Insertion
                # This is a recognized word that wasn't matched.
                # Try to find a "look-back" match for it.
                if last_match_ref_idx == -1:
                    continue  # No context to look back from

                rec_index = i - 1
                rec_word_obj = recognized_words[rec_index]
                rec_word_to_rematch = rec_word_obj.word

                # Determine the search window
                context_ayah = reference_words[last_match_ref_idx].ayah_number
                ayah_limit = context_ayah - previous_ayahs_to_match

                # Search backwards from the last match position
                best_rematch_k = -1
                for k in range(last_match_ref_idx, -1, -1):
                    ref_word_obj = reference_words[k]
                    if ref_word_obj.ayah_number < ayah_limit:
                        break  # Outside the look-back window
                    if ref_word_obj.word == rec_word_to_rematch:
                        best_rematch_k = k
                        break

                if best_rematch_k != -1:
                    # Found a rematch
                    ref_index = best_rematch_k
                    ref_word_obj = reference_words[ref_index]

                    flags = SegmentedWordSpan.MATCHED_INPUT | SegmentedWordSpan.MATCHED_REFERENCE | SegmentedWordSpan.EXACT

                    # Add flags_info for better debugging
                    flags_info = {
                        "matched_input": True,
                        "matched_reference": True,
                        "exact": True,
                        "inexact": False,
                        "rematched": True,
                    }

                    word_spans.append(
                        SegmentedWordSpan(
                            reference_index_start=ref_index,
                            reference_index_end=ref_index + 1,
                            reference_words_segment=ref_word_obj.word,
                            input_words_segment=rec_word_obj.word,
                            start=rec_word_obj.start_time,
                            end=rec_word_obj.end_time,
                            flags=flags,
                            flags_info=flags_info,
                        )
                    )
            # Deletions (operation == 2) are ignored, as they don't have timing info.

        return word_spans

    def _extract_ayah_timestamps(
        self, word_spans: List[SegmentedWordSpan], reference_words: List[ReferenceWord], reference_ayahs: List[str]
    ) -> List[AyahTimestamp]:
        """Extract ayah timestamps from word spans.

        Args:
            word_spans: List of word spans
            reference_words: List of reference words
            reference_ayahs: List of reference ayah texts

        Returns:
            List of AyahTimestamp objects
        """
        ayah_timestamps = []

        # Group reference words by ayah number
        ayah_to_ref_word_indices = {}
        for i, ref_word in enumerate(reference_words):
            if ref_word.ayah_number not in ayah_to_ref_word_indices:
                ayah_to_ref_word_indices[ref_word.ayah_number] = []
            ayah_to_ref_word_indices[ref_word.ayah_number].append(i)

        # For each ayah, find the span that contains its words
        sorted_ayah_nums = sorted(ayah_to_ref_word_indices.keys())
        for idx, ayah_number in enumerate(sorted_ayah_nums):
            ref_word_indices = ayah_to_ref_word_indices[ayah_number]
            ayah_start_idx = min(ref_word_indices)
            ayah_end_idx = max(ref_word_indices) + 1  # +1 because end is exclusive

            # Find spans that overlap with this ayah
            ayah_spans = []
            for span in word_spans:
                # Check if this span overlaps with the ayah
                if span.reference_index_end > ayah_start_idx and span.reference_index_start < ayah_end_idx:
                    ayah_spans.append(span)

            if ayah_spans:
                # Get start and end times for this ayah
                start_time = min(span.start for span in ayah_spans)
                end_time = max(span.end for span in ayah_spans)

                # Get the ayah text
                ayah_text = reference_ayahs[idx]

                ayah_timestamps.append(
                    AyahTimestamp(ayah_number=ayah_number, start_time=start_time, end_time=end_time, text=ayah_text)
                )

        return ayah_timestamps
