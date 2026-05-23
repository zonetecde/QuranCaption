"""
Service for accessing Quranic metadata.
"""

import re
from typing import Any, List, Optional, Tuple

from surah_splitter.utils.app_logger import logger
from surah_splitter.utils.paths import QURAN_METADATA_PATH
from surah_splitter.utils.file_utils import load_json
from surah_splitter.models.all_models import WordMatch


class QuranMetadataService:
    """Service for accessing Quranic metadata."""

    def __init__(self):
        self._word_index = None  # Lazy-loaded word index
        self._ayah_words = None  # Cache for ayah words by surah

    def get_ayahs(
        self,
        surah_number: Optional[int] = None,
        ayah_numbers: Optional[list[int]] = None,
        transcription: Optional[Any] = None,
    ) -> Tuple[int, Optional[list[int]], List[str]]:
        """Get cleaned ayahs (verses) for a given surah or from all surahs.

        This function can operate in three modes:
        1. With specific surah and ayahs: Returns requested ayahs from that surah
        2. With specific surah only: Returns all ayahs from that surah
        3. With transcription only: Auto-detects surah and ayah range from the audio transcription

        Args:
            surah_number: Optional surah number (1-114). If None, attempts to detect from transcription
            ayah_numbers: Optional list of specific ayahs to match. If None, returns all ayahs or detects from transcription
            transcription: Optional WhisperX transcription result to infer ayahs from

        Returns:
            Tuple containing:
            - int: Surah number that was processed
            - Optional[list[int]]: List of ayah numbers that were processed (None if all ayahs)
            - List[str]: List of cleaned ayah texts

        Examples:
            # Get specific ayahs from a surah
            >>> service.get_ayahs(surah_number=2, ayah_numbers=[1, 2, 3])
            (2, [1, 2, 3], ['بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', ...])

            # Get all ayahs from a surah
            >>> service.get_ayahs(surah_number=1)
            (1, None, ['بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', ...])

            # Auto-detect surah and ayahs from transcription
            >>> service.get_ayahs(transcription=whisperx_result)
            (78, [1, 2, 3, 4], ['عَمَّ يَتَسَآءَلُونَ', ...])

        Raises:
            FileNotFoundError: If the required metadata files are not found
            ValueError: If the surah number is invalid or not found
        """
        # Load from file
        surah_to_simple_ayahs_path = QURAN_METADATA_PATH / "surah_to_simple_ayahs.json"
        if not surah_to_simple_ayahs_path.exists():
            logger.error(f"Ayah data file not found at {surah_to_simple_ayahs_path}")
            raise FileNotFoundError(
                f"Ayah data file not found at {surah_to_simple_ayahs_path}. "
                "Please run simple_ayahs_extractor.py script first."
            )

        surah_to_simple_ayahs_dict = load_json(surah_to_simple_ayahs_path)

        # If no surah provided, use transcription to detect surah and ayah range
        if not surah_number:
            if not transcription:
                logger.error("When no surah_number is provided, transcription is required")
                raise ValueError("When no surah_number is provided, transcription is required")

            logger.info("No specific surah provided, detecting from transcription")
            detected_surah, start_ayah, end_ayah = self.detect_ayah_range_from_transcription(transcription, None)
            if not all([detected_surah, start_ayah, end_ayah]):
                logger.error("Could not detect surah and ayah range from transcription")
                return []

            surah_number = detected_surah
            ayah_numbers = list(range(start_ayah, end_ayah + 1))
            logger.info(f"Detected surah {surah_number}, ayahs {start_ayah} to {end_ayah}")

        # Handle surah case
        if str(surah_number) not in surah_to_simple_ayahs_dict:
            logger.error(f"Surah {surah_number} not found in the ayah data.")
            raise ValueError(f"Surah {surah_number} not found in the ayah data.")

        ayahs_dict = surah_to_simple_ayahs_dict[str(surah_number)]

        # If ayah_numbers is not provided, determine how to proceed
        if not ayah_numbers:
            if surah_number and surah_number >= 78:
                logger.info(f"Surah {surah_number} >= 78, returning all ayahs.")
                ayah_numbers = None
            elif transcription:
                logger.info(f"Detecting ayah range from transcription for surah {surah_number}.")
                _, start_ayah, end_ayah = self.detect_ayah_range_from_transcription(transcription, surah_number)
                logger.info(f"Detected ayah range: {start_ayah} to {end_ayah}")
                if start_ayah and end_ayah:
                    ayah_numbers = list(range(start_ayah, end_ayah + 1))

        # Filter ayahs based on ayah_numbers if provided
        ayahs = [
            ayahs_dict[v_id] for v_id in sorted(ayahs_dict.keys(), key=int) if not ayah_numbers or int(v_id) in ayah_numbers
        ]

        # Log the result with details based on what we're returning
        if ayah_numbers:
            ayah_range_str = f"{ayah_numbers[0]}-{ayah_numbers[-1]}" if len(ayah_numbers) > 1 else str(ayah_numbers[0])
            logger.success(f"Returning {len(ayahs)} ayahs for surah {surah_number} (ayahs {ayah_range_str}).")
        else:
            logger.success(f"Returning {len(ayahs)} ayahs for surah {surah_number} (all ayahs).")

        return surah_number, ayah_numbers, ayahs

    def detect_ayah_range_from_transcription(
        self,
        transcription: Any,
        surah_number: Optional[int] = None,
        first_ayah_correction: bool = True,
    ) -> Tuple[Optional[int], Optional[int], Optional[int]]:
        """Detect ayah range from a WhisperX transcription using exact consecutive word matching.

        This function implements a sophisticated word matching algorithm to determine which part of
        the Quran is being recited in an audio file. It can either search within a specific surah
        or across the entire Quran to find the best matching sequence of words.

        Args:
            transcription: WhisperX transcription result containing segments with transcribed text.
                Each segment should have a 'text' field with Arabic text.
            surah_number: Optional surah number (1-114). If provided, only searches within that surah.
                If None, uses a two-round detection:
                1. First round: Identifies most likely surah by word match frequency
                2. Second round: Focuses on detected surah to get precise ayah range
            first_ayah_correction: If True, then if the function was initially going to return a start ayah of `2`,
                it will correct itself by returning `1` instead;
                this is helpful when surahs start with small ayahs that are hard to detect (e.g., surah `02`, etc.)

        Returns:
            Tuple of (surah_number, start_ayah, end_ayah). All values will be None if:
            - No matches found
            - Transcription has no segments
            - Word index is not loaded/empty
            - Specified surah_number doesn't match detected surah

        Examples:
            # Auto-detect surah and ayah range from transcription
            >>> result = service.detect_ayah_range_from_transcription(transcription)
            >>> print(result)
            (78, 1, 5)  # Indicates Surah 78, Ayahs 1-5 were detected

            # Search within a specific surah
            >>> result = service.detect_ayah_range_from_transcription(transcription, surah_number=1)
            >>> print(result)
            (1, 2, 4)  # Found matches in Surah 1, Ayahs 2-4

            # No matches found
            >>> result = service.detect_ayah_range_from_transcription(empty_transcription)
            >>> print(result)
            (None, None, None)

        Notes:
            - The function is robust to minor transcription errors and can handle gaps
              in the text through its max_unmatched_words parameter
            - Uses a word index for efficient lookup of Arabic words
            - Strips diacritics and normalizes Arabic text for better matching
        """
        if not transcription.get("segments"):
            logger.warning("Transcription data has no segments.")
            return None, None, None

        if self._word_index is None:
            logger.debug("Word index not loaded, loading now.")
            self._load_word_index()

        if not self._word_index:
            logger.error("Word index is empty after loading.")
            return None, None, None

        # Extract and clean words from transcription
        transcribed_words = []
        for segment in transcription["segments"]:
            if "text" in segment:
                words = self._clean_text(segment["text"])
                transcribed_words.extend(words)

        logger.debug(f"Extracted {len(transcribed_words)} words from transcription")

        # If no surah specified, do two-round detection
        if not surah_number:
            logger.info("No surah specified, starting first round to detect most likely surah")

            # First round: Find matches across all surahs
            round1_matches = self._find_consecutive_matches(transcribed_words, None)
            if not round1_matches:
                logger.warning("No significant matches found in first round")
                return None, None, None

            # Count surah frequencies in matches
            surah_frequencies: dict[int, int] = {}
            for sequence in round1_matches:
                for match in sequence:
                    surah_frequencies[match.surah] = surah_frequencies.get(match.surah, 0) + 1

            if not surah_frequencies:
                logger.warning("No surah frequencies found")
                return None, None, None

            # Find the most frequent surah
            most_likely_surah = max(surah_frequencies.items(), key=lambda x: x[1])[0]
            logger.info(
                f"First round detected most likely surah: {most_likely_surah} "
                f"(frequency: {surah_frequencies[most_likely_surah]})"
            )

            # Log all surah frequencies for debugging
            for surah, freq in sorted(surah_frequencies.items()):
                logger.debug(f"Surah {surah}: {freq} matches")

            # Second round: Focus on the detected surah
            logger.info(f"Starting second round with focus on surah {most_likely_surah}")
            matches = self._find_consecutive_matches(transcribed_words, most_likely_surah)
        else:
            # Single round with specified surah
            matches = self._find_consecutive_matches(transcribed_words, surah_number)

        if not matches:
            logger.warning("No significant consecutive word matches found.")
            return None, None, None

        # Determine the ayah range
        detected_surah, start_ayah, end_ayah = self._determine_ayah_range_from_matches(matches)

        # If a specific surah was requested but we found matches in a different surah
        if surah_number and detected_surah != surah_number:
            logger.warning(
                f"Found matches in surah {detected_surah} but surah {surah_number} was requested. " "Returning no matches."
            )
            return None, None, None

        if first_ayah_correction and start_ayah == 2:
            start_ayah = 1
            logger.warning("Will start from ayah `1` instead of `2` due to `first_ayah_correction` flag)")

        logger.info(f"Determined range in surah {detected_surah}: ayahs {start_ayah} to {end_ayah}")

        return detected_surah, start_ayah, end_ayah

    def _find_consecutive_matches(
        self, transcribed_words: List[str], target_surah: Optional[int] = None, max_unmatched_words: int = 2
    ) -> List[List[WordMatch]]:
        """Find sequences of consecutively matching words in any or a specific surah.

        This function implements a sliding window approach to find sequences of matching words,
        allowing for some flexibility with unmatched words to handle transcription errors.

        Args:
            transcribed_words: List of cleaned Arabic words from transcription.
                Words should be preprocessed (diacritics removed, normalized).
            target_surah: Optional surah number to match against. If None, searches all surahs.
            max_unmatched_words: Maximum number of consecutive unmatched words allowed before
                breaking a sequence. These words will be assumed to continue the sequence.

        Returns:
            List of matching sequences, where each sequence is a list of WordMatch objects.
            When target_surah is None, sequences may contain matches from different surahs.

        Examples:
            # Find matches in a specific surah
            >>> words = ['عَمَّ', 'يَتَسَآءَلُونَ', 'عَنِ']
            >>> matches = service._find_consecutive_matches(words, target_surah=78)
            >>> print([[m.word for m in seq] for seq in matches])
            [['عَمَّ', 'يَتَسَآءَلُونَ', 'عَنِ']]  # Perfect match in Surah 78

            # Find matches across all surahs with unmatched words
            >>> words = ['بِسْمِ', 'UNKNOWN_WORD', 'ٱلرَّحْمَٰنِ']
            >>> matches = service._find_consecutive_matches(words, max_unmatched_words=1)
            >>> print([[m.word for m in seq] for seq in matches])
            [['بِسْمِ', 'UNKNOWN_WORD', 'ٱلرَّحْمَٰنِ']]  # Match with one unmatched word

        Notes:
            - The function maintains sequence coherence by checking position proximity
            - Unmatched words are incorporated into sequences if within max_unmatched_words
            - When searching all surahs, sequences are maintained within individual surahs
            - Results are sorted by sequence length and surah number for consistency
        """

        def save_sequence(seq: List[WordMatch], sequences: List[List[WordMatch]]) -> None:
            """Helper to save a sequence if it's long enough."""
            if len(seq) >= 2:
                # When searching all surahs, log surah number for better context
                surah_info = "" if target_surah else f" in surah {seq[0].surah}"
                logger.trace(f"Saving sequence of length {len(seq)}{surah_info}: {[m.word for m in seq]}")
                sequences.append(seq[:])

        def find_best_continuation(word_matches: List[WordMatch], last_match: WordMatch) -> Optional[WordMatch]:
            """Find the best continuation match for the current sequence."""
            # When searching all surahs, only continue sequence within same surah
            candidates = [
                m
                for m in word_matches
                if m.surah == last_match.surah  # Must be in same surah
                and m.ayah == last_match.ayah
                and abs(m.position_wrt_surah - last_match.position_wrt_surah) <= 2
            ]
            if not candidates:
                return None
            # Return the closest match by position
            return min(candidates, key=lambda m: abs(m.position_wrt_surah - last_match.position_wrt_surah))

        matches: List[List[WordMatch]] = []
        current_sequence: List[WordMatch] = []
        unmatched_count: int = 0

        search_scope = "surah " + str(target_surah) if target_surah else "all surahs"
        logger.info(f"Starting word matching for {len(transcribed_words)} words across {search_scope}")

        for i, word in enumerate(transcribed_words):
            # Try to match the word in the target surah or all surahs
            matches_for_word = [
                WordMatch(surah=occ["surah"], ayah=occ["ayah"], position_wrt_surah=occ["position_wrt_surah"], word=word)
                for occ in self._word_index.get(word, [])
                if not target_surah or occ["surah"] == target_surah
            ]

            if not matches_for_word:
                # Check if we can continue the sequence despite unmatched word
                if current_sequence and unmatched_count < max_unmatched_words:
                    unmatched_count += 1
                    logger.warning(
                        f"No matches for '{word}' but continuing sequence "
                        f"(unmatched words: {unmatched_count}/{max_unmatched_words})"
                    )
                    # Create a synthetic match continuing the sequence
                    last_match = current_sequence[-1]
                    synthetic_match = WordMatch(
                        surah=last_match.surah,
                        ayah=last_match.ayah,
                        position_wrt_surah=last_match.position_wrt_surah + 1,
                        word=word,
                    )
                    current_sequence.append(synthetic_match)
                    continue
                else:
                    if current_sequence:
                        logger.trace(f"No matches for '{word}', max unmatched words exceeded, saving current sequence")
                    save_sequence(current_sequence, matches)
                    current_sequence = []
                    unmatched_count = 0
                    continue

            # Reset unmatched count since we found a match
            unmatched_count = 0

            # If we have a sequence going, try to continue it
            if current_sequence:
                next_match = find_best_continuation(matches_for_word, current_sequence[-1])
                if next_match:
                    logger.trace(
                        f"Continuing sequence with '{word}' at position {next_match.position_wrt_surah} in surah {next_match.surah}"
                    )
                    current_sequence.append(next_match)
                    continue

                # No continuation found, save current and start new
                save_sequence(current_sequence, matches)
                current_sequence = []

            # Start new sequence with this word
            current_sequence = [matches_for_word[0]]
            logger.trace(f"Starting new sequence with '{word}' in surah {matches_for_word[0].surah}")

        # Save any remaining sequence
        save_sequence(current_sequence, matches)

        # When searching all surahs, sort by sequence length and surah number for consistent results
        matches.sort(key=lambda seq: (-len(seq), seq[0].surah, seq[0].ayah, seq[0].position_wrt_surah))

        logger.info(f"Found {len(matches)} sequences")
        for i, seq in enumerate(matches, 1):
            surah_info = f" in surah {seq[0].surah}" if not target_surah else ""
            logger.trace(f"Sequence {i}: {len(seq)} words{surah_info}, starts at ayah {seq[0].ayah}")

        return matches

    def _determine_ayah_range_from_matches(
        self, matches: List[List[WordMatch]], max_allowed_gap: int = 2
    ) -> Tuple[Optional[int], Optional[int], Optional[int]]:
        """Determine the most likely ayah range from word matches.

        This function analyzes sequences of word matches to find the longest consecutive
        sequence of ayahs, allowing for small gaps. It helps identify the most likely
        continuous section of the Quran being recited.

        Args:
            matches: List of matching sequences, where each sequence is a list of WordMatch objects.
                Each WordMatch contains surah number, ayah number, and position information.
            max_allowed_gap: Maximum number of ayahs that can be missing between two
                consecutive ayahs to still consider them part of the same sequence.
                For example, with max_allowed_gap=2:
                - Sequence [1,2,3,4] is considered continuous
                - Sequence [1,2,5,6] is considered continuous (gap of 2 ayahs)
                - Sequence [1,2,6,7] is split (gap of 3 ayahs)

        Returns:
            Tuple of (surah, start_ayah, end_ayah) representing the longest consecutive
            ayah sequence. Returns (None, None, None) if no valid sequence is found.

        Examples:
            # Perfect consecutive sequence
            >>> matches = [[WordMatch(78, 1, 1, 'word1')],
            ...           [WordMatch(78, 2, 1, 'word2')],
            ...           [WordMatch(78, 3, 1, 'word3')]]
            >>> result = service._determine_ayah_range_from_matches(matches)
            >>> print(result)
            (78, 1, 3)  # Surah 78, Ayahs 1-3

            # Sequence with allowed gap
            >>> matches = [[WordMatch(1, 1, 1, 'word1')],
            ...           [WordMatch(1, 3, 1, 'word2')]]  # Gap of 1 ayah
            >>> result = service._determine_ayah_range_from_matches(matches, max_allowed_gap=2)
            >>> print(result)
            (1, 1, 3)  # Considers it a continuous sequence

            # Multiple sequences in different surahs
            >>> matches = [[WordMatch(1, 1, 1, 'word1')],
            ...           [WordMatch(2, 1, 1, 'word2')],
            ...           [WordMatch(2, 2, 1, 'word3')]]
            >>> result = service._determine_ayah_range_from_matches(matches)
            >>> print(result)
            (2, 1, 2)  # Picks longest sequence (in Surah 2)

        Notes:
            - Prioritizes longer sequences over shorter ones
            - Handles multiple sequences across different surahs
            - Considers gaps up to max_allowed_gap to be part of the same sequence
            - Useful for handling audio files where some ayahs might be missed in transcription
        """
        if not matches:
            logger.warning("No matches to determine range from")
            return None, None, None

        # Group matches by surah to find the best sequence within each surah
        surah_to_matches: dict[int, set[int]] = {}
        for sequence in matches:
            surah = sequence[0].surah
            if surah not in surah_to_matches:
                surah_to_matches[surah] = set()
            sequence_ayahs = set(m.ayah for m in sequence)
            surah_to_matches[surah].update(sequence_ayahs)
            logger.trace(f"Sequence ayahs in surah {surah}: {sorted(sequence_ayahs)}, " f"words: {[m.word for m in sequence]}")

        # Find the longest sequence in each surah, allowing gaps up to max_allowed_gap ayahs
        best_surah = None
        best_start = None
        best_length = 0

        for surah, ayahs in surah_to_matches.items():
            sorted_ayahs = sorted(ayahs)
            logger.info(f"Analyzing ayahs in surah {surah}: {sorted_ayahs}")

            current_start = sorted_ayahs[0]
            current_length = 1
            last_ayah = sorted_ayahs[0]

            for i in range(1, len(sorted_ayahs)):
                gap = sorted_ayahs[i] - last_ayah
                if gap <= max_allowed_gap + 1:  # Add 1 because gap of 3 means difference of 2 ayahs (e.g., 3 to 5)
                    # Continue current sequence even with small gap
                    current_length += 1
                    if gap > 1:
                        logger.warning(f"Including gap in sequence: {last_ayah} to {sorted_ayahs[i]} (gap of {gap-1} ayahs)")
                else:
                    # Gap too large, check if this was the best sequence so far
                    if current_length > best_length:
                        best_length = current_length
                        best_start = current_start
                        best_surah = surah
                    # Start new sequence
                    current_start = sorted_ayahs[i]
                    current_length = 1
                    logger.trace(f"Gap too large: {last_ayah} to {sorted_ayahs[i]} (gap of {gap-1} ayahs)")

                last_ayah = sorted_ayahs[i]

            # Check the last sequence
            if current_length > best_length:
                best_length = current_length
                best_start = current_start
                best_surah = surah

        # Return results
        if best_length < 2 or best_surah is None:
            logger.warning("No consecutive ayahs found in any surah")
            return None, None, None

        end_ayah = last_ayah  # Use the actual last ayah instead of calculating
        logger.info(
            f"Found longest sequence in surah {best_surah}: "
            f"ayahs {best_start} to {end_ayah} (length: {best_length}, max gap allowed: {max_allowed_gap})"
        )

        return best_surah, best_start, end_ayah

    def _load_word_index(self) -> None:
        """Load the word index file."""
        word_index_path = QURAN_METADATA_PATH / "quran_word_index.json"
        if not word_index_path.exists():
            logger.warning(f"Word index not found at {word_index_path}")
            self._word_index = {}
            return

        try:
            self._word_index = load_json(word_index_path)
            logger.info(f"Loaded word index from {word_index_path}")
        except Exception as e:
            logger.error(f"Error loading word index: {e}")
            self._word_index = {}

    def _clean_text(self, text: str) -> List[str]:
        """Clean Arabic text by removing diacritics and non-Arabic characters.

        Args:
            text: Input Arabic text, which may contain diacritics, punctuation,
                and other non-Arabic characters.

        Returns:
            List of cleaned Arabic words.

        Examples:
            >>> text = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ."
            >>> service._clean_text(text)
            ['بسم', 'الله', 'الرحمن', 'الرحيم']

            >>> text = "عَمَّ     يَتَسَآءَلُونَ؟"  # Extra spaces and punctuation
            >>> service._clean_text(text)
            ['عم', 'يتساءلون']

        Notes:
            - See regex in code and https://jrgraphix.net/r/Unicode/0600-06FF for Unicode details
        """
        # Keep only specified Arabic letters and spaces
        # Check this for details:
        #   https://jrgraphix.net/r/Unicode/0600-06FF
        text = re.sub(r"[^\u060f\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\s]", "", text)

        # Normalize spaces and split into words
        text = re.sub(r"\s+", " ", text).strip()
        return text.split()

    def get_surah_name(self, surah_number: int) -> str:
        """Get the name of a surah by its number.

        This function retrieves the Arabic name of a surah from the metadata file.
        Surah numbers range from 1 to 114 in the Quran.

        Args:
            surah_number: Surah number (1-114)

        Returns:
            Arabic name of the surah

        Raises:
            FileNotFoundError: If the surah metadata file is not found
            ValueError: If the surah number is not between 1 and 114
        """
        logger.info(f"Getting surah name for surah {surah_number}")
        surah_metadata_path = QURAN_METADATA_PATH / "quran-metadata-surah-name.json"

        if not surah_metadata_path.exists():
            logger.error(f"Surah metadata file not found at {surah_metadata_path}")
            raise FileNotFoundError(f"Surah metadata file not found at {surah_metadata_path}")

        surah_metadata = load_json(surah_metadata_path)
        surah_number_str = str(surah_number)

        if surah_number_str not in surah_metadata:
            logger.error(f"Surah {surah_number} not found in the metadata")
            raise ValueError(f"Surah {surah_number} not found in the metadata")

        surah_name = surah_metadata[surah_number_str]
        logger.info(f"Surah {surah_number} name: {surah_name}")

        return surah_name
