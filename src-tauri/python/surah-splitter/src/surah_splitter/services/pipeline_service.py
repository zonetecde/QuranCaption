"""
Service for orchestrating the complete processing pipeline.
"""

from pathlib import Path
from typing import Dict, Any, Optional

from surah_splitter.services.transcription_service import TranscriptionService
from surah_splitter.services.ayah_matching_service import AyahMatchingService
from surah_splitter.services.segmentation_service import SegmentationService
from surah_splitter.services.quran_metadata_service import QuranMetadataService
from surah_splitter.utils.app_logger import logger
import shutil


class PipelineService:
    """Service for orchestrating the complete processing pipeline."""

    def __init__(self):
        self.transcription_service = TranscriptionService()
        self.ayah_matching_service = AyahMatchingService()
        self.segmentation_service = SegmentationService()
        self.quran_service = QuranMetadataService()

    def process_surah(
        self,
        audio_path: Path,
        reciter_name: str,
        output_dir: Path,
        surah_number: Optional[int] = None,
        ayah_numbers: Optional[list[int]] = None,
        model_name: str = "OdyAsh/faster-whisper-base-ar-quran",
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
        save_intermediates: bool = False,
        save_incoming_surah_audio: bool = False,
    ) -> Dict[str, Any]:
        """
        Process a surah audio file through the complete pipeline.

        This method orchestrates the transcription, ayah matching, and segmentation
        steps to process the input audio file and generate individual ayah audio files.

        Args:
            audio_path: Path to the surah audio file.
            surah_number: Surah number (1-114).
            reciter_name: Name of the reciter.
            output_dir: Base directory to save the output files.
            ayah_numbers: Optional list of specific ayahs to process.
            model_name: Name of the transcription model to use.
            device: Device to use for processing (cuda or cpu).
            compute_type: Type of computation (e.g., float16, int8).
            save_intermediates: Whether to save intermediate files.
            save_incoming_surah_audio: Whether to save the original surah audio.

        Returns:
            A dictionary containing the results of transcription, ayah matching,
            and segmentation.
        """
        logger.info(f"Starting processing pipeline for reciter {reciter_name}")

        # Create timestamps directory if needed - using temporary surah_number
        timestamps_dir = None
        if save_intermediates:
            if surah_number is None:
                logger.warning("No surah number provided, using temporary directory")
                temp_dir = output_dir / reciter_name / "timestamps" / "temp"
            else:
                temp_dir = output_dir / reciter_name / "timestamps" / f"{surah_number:03d}"
            timestamps_dir = temp_dir
            timestamps_dir.mkdir(parents=True, exist_ok=True)
            logger.debug(f"Created timestamps directory: {timestamps_dir}")

        # Step 1: Initialize transcription service
        logger.info("Initializing transcription service")
        self.transcription_service.initialize(model_name, device, compute_type)

        # Step 2: Transcribe audio
        logger.info(f"Transcribing audio: {audio_path}")
        transcription_result = self.transcription_service.transcribe_and_align(audio_path, timestamps_dir)
        logger.success("Transcription completed")

        # Step 3: Get reference ayahs and metadata
        logger.info("Loading reference ayahs")
        surah_number, ayah_numbers, reference_ayahs = self.quran_service.get_ayahs(
            surah_number, ayah_numbers, transcription_result.get("transcription")
        )
        logger.debug(
            f"Loaded {len(reference_ayahs)} reference ayahs for surah {surah_number}{' ayahs ' + ','.join(map(str, ayah_numbers)) if ayah_numbers else ''}"
        )

        # Update timestamps directory with correct surah number if it was initially unknown
        if save_intermediates and surah_number and timestamps_dir.name == "temp":
            new_timestamps_dir = output_dir / reciter_name / "timestamps" / f"{surah_number:03d}"
            new_timestamps_dir.mkdir(parents=True, exist_ok=True)
            if timestamps_dir.exists():
                for file in timestamps_dir.iterdir():
                    shutil.copy2(file, new_timestamps_dir)
                shutil.rmtree(timestamps_dir, ignore_errors=True)
            timestamps_dir = new_timestamps_dir
            logger.debug(f"Updated timestamps directory to: {timestamps_dir}")

        # Step 4: Match ayahs to transcription
        logger.info("Matching ayahs to transcription")
        ayah_matching_result = self.ayah_matching_service.match_ayahs(
            transcription_result, reference_ayahs, ayah_numbers, timestamps_dir, save_intermediates
        )
        logger.success("Ayah matching completed")

        # Step 4: Split audio by ayahs
        logger.info("Splitting audio by ayahs")
        segmentation_result = self.segmentation_service.split_audio(
            audio_path,
            ayah_matching_result["ayah_timestamps"],
            surah_number,
            reciter_name,
            output_dir,
            save_incoming_surah_audio,
        )
        logger.success("Audio segmentation completed")

        logger.success(f"Pipeline processing completed for surah {surah_number} by {reciter_name}")
        return {
            "transcription": transcription_result,
            "ayah_matching": ayah_matching_result,
            "segmentation": {ayah: str(path) for ayah, path in segmentation_result.items()},
            "reciter_name": reciter_name,
            "surah_number": surah_number,
        }
