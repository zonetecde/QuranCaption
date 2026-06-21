"""
Service for segmenting audio based on ayah timestamps.
"""

from pathlib import Path
from typing import Dict, List
import shutil
from pydub import AudioSegment

from surah_splitter.utils.app_logger import logger


class SegmentationService:
    """Service for segmenting audio based on ayah timestamps."""

    def split_audio(
        self,
        audio_path: Path,
        ayah_timestamps: List[Dict],
        surah_number: int,
        reciter_name: str,
        output_dir: Path,
        save_incoming_surah_audio: bool = False,
    ) -> Dict[int, Path]:
        """Split audio based on ayah timestamps.

        Args:
            audio_path: Path to original surah audio
            ayah_timestamps: List of ayah timestamps from AyahMatchingService
            surah_number: Surah number
            reciter_name: Name of reciter
            output_dir: Base output directory
            save_incoming_surah_audio: Whether to save original surah audio

        Returns:
            Dict mapping ayah numbers to output audio paths
        """
        logger.info(f"Splitting audio {audio_path} for surah {surah_number}")

        # Load audio
        try:
            audio = AudioSegment.from_file(audio_path)
            logger.debug(f"Loaded audio of length {len(audio)/1000:.2f} seconds")
        except Exception as e:
            logger.error(f"Error loading audio file: {e}")
            raise

        # Create output directories
        reciter_output_dir = output_dir / reciter_name
        ayah_audio_dir = reciter_output_dir / "ayah_audios" / f"{surah_number:03d}"
        ayah_audio_dir.mkdir(parents=True, exist_ok=True)

        logger.debug(f"Created output directory: {ayah_audio_dir}")

        # Save original surah if requested
        if save_incoming_surah_audio:
            surah_audio_dir = reciter_output_dir / "surah_audios"
            surah_audio_dir.mkdir(parents=True, exist_ok=True)
            surah_audio_path = surah_audio_dir / f"{surah_number:03d}.mp3"

            logger.info(f"Saving original surah audio to {surah_audio_path}")

            # Use shutil.copy2 to preserve metadata
            shutil.copy2(audio_path, surah_audio_path)

        # Split audio by ayahs
        logger.info(f"Writing ayah audio files to {ayah_audio_dir}")
        output_paths = {}
        for timestamp in ayah_timestamps:
            ayah_number = timestamp["ayah_number"]
            start_ms = timestamp["start_time"] * 1000  # Convert to milliseconds to accurately save segment
            end_ms = timestamp["end_time"] * 1000

            logger.trace(f"Writing audio of ayah {ayah_number}, time range: {start_ms/1000:.2f}s - {end_ms/1000:.2f}s")

            # Extract segment
            segment = audio[start_ms:end_ms]

            # Save segment
            output_path = ayah_audio_dir / f"{surah_number:03d}_{ayah_number:03d}.mp3"
            segment.export(output_path, format="mp3")

            output_paths[ayah_number] = output_path

        logger.success(
            f"Successfully split surah {surah_number} into {len(output_paths)} ayahs and exported to {ayah_audio_dir}"
        )
        return output_paths
