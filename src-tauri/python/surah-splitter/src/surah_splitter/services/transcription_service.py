"""
Service for transcribing audio using WhisperX.
"""

from pathlib import Path
from typing import Optional
import gc

from huggingface_hub import snapshot_download

# Quick fix to make `import load_model` load faster
#   Source: https://github.com/m-bain/whisperX/issues/656#issuecomment-1877955404
from huggingface_hub.utils import _runtime

_runtime._is_google_colab = False

from surah_splitter.models.all_models import RecognizedSentencesAndWords
from surah_splitter.utils.app_logger import logger, LoggerTimingContext
from surah_splitter.utils.file_utils import save_json, load_json  # noqa: F401


class TranscriptionService:
    """Service for transcribing audio using WhisperX."""

    def __init__(self):
        self.device = None
        self.compute_type = None
        self.wx_trans_model = None
        self.wx_align_model = None
        self.wx_load_audio = None
        self._torch_cuda = None

    def initialize(
        self,
        model_name: str = "OdyAsh/faster-whisper-base-ar-quran",
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
    ):
        """
        Initialize the transcription and alignment models.

        Args:
            model_name: Name of the model to use
            device: Device to use (cuda/cpu)
            compute_type: Type of computation to use (e.g., "float16", "int8", etc.)

        Notes:
            If you want to know the supported `compute_type`s, run the following in a REPL:
            ```python
            import ctranslate2
            print(ctranslate2.get_supported_compute_types("cpu")) # or "cuda"
            # output examples:
            # for cpu: -> {'int8', 'float32', 'int8_float32'}
            # for cuda: -> {'float32', 'int8', 'float16', 'int8_float32', 'int8_float16'}
            ```
            Source with details: https://opennmt.net/CTranslate2/quantization.html#implicit-type-conversion-on-load
        """
        logger.info(f"Initializing transcription service with model: {model_name}")

        from torch import cuda

        self._torch_cuda = cuda

        # Set device (cuda if available, otherwise cpu)
        if device is None:
            self.device = "cuda" if self._torch_cuda.is_available() else "cpu"
        else:
            self.device = device
        logger.debug(f"Using device: {self.device}")

        if compute_type is None:
            self.compute_type = "float16" if self.device == "cuda" else "int8"
        else:
            self.compute_type = compute_type
        logger.debug(f"Using compute type: {self.compute_type}")

        # Initialize WhisperX transcription model
        try:
            with LoggerTimingContext("Initializing WhisperX models"):
                from whisperx.asr import load_model

            # If it's a HuggingFace model, first download it
            # Otherwise assume it's a whisperx model size
            if "/" in model_name:
                with LoggerTimingContext(f'Downloading "{model_name}" from HuggingFace'):
                    model_path = snapshot_download(repo_id=model_name)
                    model_name = model_path  # Use the local path after download

            with LoggerTimingContext("Loading WhisperX model"):
                self.wx_trans_model = load_model(
                    model_name,
                    self.device,
                    compute_type=self.compute_type,
                    language="ar",
                    vad_method="silero",  # pyannote/silero, default: pyannote
                    # NOTE: The below options were an attempt to make the model repeat certain words that were not transcribed,
                    # for example, قواريرا in Surah 76, but it didn't make a difference.
                    # HOWEVER, what ACTUALLY made a difference is changing the vad_method above to silero instead of pyannote
                    # so I might try different vad models in the future to see if they help with this...
                    asr_options={
                        # "compression_ratio_threshold": 10,  # default: 2.4
                        # "condition_on_previous_text": True,  # default: False
                    },
                    # NOTE: if using "silero", then only vad_onset is used (since the actual silero models don't support it),
                    #   and if using "pyannote", then both are used in Binarize() class,
                    #   but not when loading the hyperparmeters of the pyannote VAD model itself
                    #   (which is weird?)
                    vad_options={
                        "vad_onset": 0.2,
                        # "vad_offset": 0.2,
                    },
                )

            from whisperx.audio import load_audio

            self.wx_load_audio = load_audio

            # Initialize alignment model
            with LoggerTimingContext("Importing WhisperX alignment model"):
                from whisperx.alignment import load_align_model

                self.wx_align_model, self.align_metadata = load_align_model(
                    language_code="ar",
                    device=self.device,
                    # If `model_name` is not mentioned, it will use the default alignment model for `ar`, which is:
                    # jonatasgrosman/wav2vec2-large-xlsr-53-arabic/tree/main
                    # NOTE: Commented out for now, since the default model is tested to be better
                    # model_name="HamzaSidhu786/wav2vec2-base-word-by-word-quran-asr",
                )

        except Exception as e:
            logger.error(f"Failed to initialize models: {str(e)}")
            raise

    def transcribe_and_align(self, audio_path: Path, output_dir: Optional[Path] = None) -> RecognizedSentencesAndWords:
        """
        Transcribe an audio file and align words to generate word-level timestamps.

        Args:
            audio_path: Path to the input audio file.
            output_dir: Optional directory to save intermediate files.

        Returns:
            A dictionary containing transcription results and word-level timestamps.
        """
        logger.info(f"Transcribing audio file: {audio_path}")

        # Load audio
        with LoggerTimingContext("Loading audio file"):
            audio = self.wx_load_audio(audio_path)

        # Ensure models are initialized
        if self.wx_trans_model is None or self.wx_align_model is None:
            logger.debug("Models not initialized, initializing now")
            self.initialize()

        # Perform transcription
        with LoggerTimingContext("Transcribing audio", succ_log=True):
            # Comment/uncomment accordingly if you're testing
            # trans_result = load_json(output_dir / "01_transcription.json")
            trans_result = self.wx_trans_model.transcribe(
                audio,
                batch_size=16,  # if not set, internally becomes 1
                language="ar",
                verbose=False,  # (output_dir is not None)
            )

        # Save transcription result
        if output_dir:
            save_json(data=trans_result, output_dir=output_dir, filename="01_transcription.json")

        # Perform word alignment
        with LoggerTimingContext("Aligning to word-level timestamps", succ_log=True):
            from whisperx.alignment import align

            # Comment/uncomment accordingly if you're testing
            # align_result = load_json(output_dir / "02_alignment.json")
            align_result = align(
                trans_result["segments"],
                self.wx_align_model,
                self.align_metadata,
                audio,
                self.device,
                print_progress=True,
                combined_progress=False,
            )

        # Save alignment result
        if output_dir:
            save_json(data=align_result, output_dir=output_dir, filename="02_alignment.json")

        # Create result dictionary
        result = {
            "transcription": trans_result,
            "word_segments": align_result.get("word_segments", []),
        }

        logger.success(f"Transcription of {audio_path.name} complete")
        return result

    def __del__(self):
        """
        Clean up resources when the service is destroyed.

        Notes:
            This method ensures GPU memory is released if the service was using CUDA.
        """
        # Clean up GPU memory if needed
        if self.device == "cuda":
            logger.debug("Cleaning up GPU memory on service destruction")
            gc.collect()
            if self._torch_cuda:
                self._torch_cuda.empty_cache()
