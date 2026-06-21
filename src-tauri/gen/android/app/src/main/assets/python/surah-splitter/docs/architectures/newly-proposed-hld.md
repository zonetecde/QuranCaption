# Proposed Architecture Improvements for Surah Splitter

This document outlines proposed architectural improvements to the Surah Splitter project to enhance modularity, reduce parameter passing, and improve maintainability.

## Current Architecture Analysis

The existing architecture follows a primarily procedural approach with some modular organization. From reviewing the HLD, I've identified these challenges:

1. **Excessive Parameter Passing**: Functions like `process_surah()` and `match_ayahs_to_transcription()` accept numerous parameters passed through multiple function layers
2. **Limited Encapsulation**: Data and behavior are often separated
3. **Implicit Dependencies**: Many components have hidden dependencies on file structure and data formats
4. **Manual State Management**: Processing state must be explicitly tracked and passed between functions

## Proposed Architecture Patterns

Based on these observations, I'm proposing several architectural patterns that could improve the project structure. Each offers different trade-offs.

### 1. Object-Oriented Design with Domain Objects

This pattern organizes the system around key domain entities (Surah, Ayah, Transcription, etc.) as classes with associated behaviors.

#### Core Abstractions:

- `SurahProcessor`: Manages the end-to-end processing pipeline
- `AudioTranscriber`: Handles WhisperX integration
- `AyahMatcher`: Performs alignment between transcription and reference text
- `AudioSegmenter`: Splits audio based on ayah boundaries

#### Example Implementation Comparison:

**Current Implementation (Procedural):**
```python
# In surah_processor.py
def process_surah(surah_audio_path, surah_number, output_dir, reference_ayahs):
    # Load audio
    audio = _load_audio(surah_audio_path)
    
    # Process audio with WhisperX
    whisperx_result = _process_audio_file(audio, surah_audio_path, output_dir)
    
    # Match ayahs to transcription
    ayah_timestamps = match_ayahs_to_transcription(
        whisperx_result, reference_ayahs, output_dir, surah_number
    )
    
    # Split audio by ayahs
    split_audio_by_ayahs(audio, ayah_timestamps, output_dir, surah_number)
    
    # ...
```

**Proposed Implementation (Object-Oriented):**
```python
# In surah_processor.py
class SurahProcessor:
    def __init__(self, surah_number, output_dir):
        self.surah_number = surah_number
        self.output_dir = output_dir
        self.transcriber = AudioTranscriber()
        self.matcher = AyahMatcher()
        self.segmenter = AudioSegmenter()
        self.reference_ayahs = self._load_reference_ayahs()
        
    def _load_reference_ayahs(self):
        # Load reference ayahs from quran metadata
        # ...
        
    def process(self, surah_audio_path):
        # Load audio
        audio = self._load_audio(surah_audio_path)
        
        # Process with transcriber
        transcription = self.transcriber.transcribe(audio)
        
        # Match ayahs
        ayah_timestamps = self.matcher.match(
            transcription, 
            self.reference_ayahs, 
            self.surah_number
        )
        
        # Split audio
        self.segmenter.split(audio, ayah_timestamps, self.output_dir, self.surah_number)
        
        return {
            "transcription": transcription,
            "ayah_timestamps": ayah_timestamps
        }
```

**Benefits:**
- Encapsulates related data and behavior
- Reduces parameter passing
- Provides clear responsibility boundaries
- Makes testing individual components easier

### 2. Pipeline Pattern

This design treats the application as a series of data transformations in a pipeline, with each stage producing output for the next stage.

#### Core Components:

- `Pipeline`: Orchestrates the execution of stages
- `TranscriptionStage`: Produces transcription from audio
- `AlignmentStage`: Aligns transcription with reference text
- `SegmentationStage`: Creates ayah audio segments

#### Example Implementation:

**Current Implementation:**
```python
# In main_cli.py
def process_surah_command(surah_path, output_dir):
    # Extract surah number from path
    surah_number = _extract_surah_number(surah_path)
    
    # Load reference ayahs
    reference_ayahs = _load_reference_ayahs(surah_number)
    
    # Process surah
    surah_processor.process_surah(
        surah_path, 
        surah_number, 
        output_dir, 
        reference_ayahs
    )
```

**Proposed Implementation (Pipeline):**
```python
# In pipeline.py
class SurahPipeline:
    def __init__(self, stages=None):
        self.stages = stages or [
            TranscriptionStage(),
            AlignmentStage(),
            SegmentationStage()
        ]
    
    def process(self, context):
        """
        Process a surah through all pipeline stages
        
        Args:
            context: A dictionary containing initial pipeline data
                    (surah_path, surah_number, output_dir)
        
        Returns:
            Updated context with all stage outputs
        """
        for stage in self.stages:
            context = stage.process(context)
        return context

# In stages.py
class TranscriptionStage:
    def process(self, context):
        audio = self._load_audio(context["surah_path"])
        context["audio"] = audio
        context["transcription"] = self._transcribe(audio)
        return context

class AlignmentStage:
    def process(self, context):
        reference_ayahs = self._load_reference_ayahs(context["surah_number"])
        context["ayah_timestamps"] = self._align(
            context["transcription"], 
            reference_ayahs
        )
        return context

# In main_cli.py
def process_surah_command(surah_path, output_dir):
    pipeline = SurahPipeline()
    
    # Create initial context
    context = {
        "surah_path": surah_path,
        "surah_number": _extract_surah_number(surah_path),
        "output_dir": output_dir
    }
    
    # Run pipeline
    result = pipeline.process(context)
```

**Benefits:**
- Clear separation of processing stages
- Easy to add/remove/reorder processing steps
- Unified context object eliminates parameter passing between stages
- Supports parallel processing of stages if needed

### 3. Service-Based Architecture

This pattern organizes the system around specialized services that work with data repositories.

#### Core Services:

- `TranscriptionService`: Handles audio transcription
- `AlignmentService`: Performs text alignment 
- `AudioService`: Manages audio processing
- `QuranMetadataRepository`: Provides access to Quranic reference data

#### Example Implementation:

**Current Implementation:**
```python
# In ayah_matcher.py
def match_ayahs_to_transcription(whisperx_result, reference_ayahs, output_dir, surah_number):
    # Extract recognized words
    recognized_words = _extract_recognized_words(whisperx_result)
    
    # Extract reference words
    reference_words = _extract_reference_words(reference_ayahs)
    
    # Align words
    word_spans = align_words(recognized_words, reference_words)
    
    # Extract ayah timestamps
    ayah_timestamps = _extract_ayah_timestamps(word_spans, reference_ayahs)
    
    # Save intermediate outputs
    _save_outputs(output_dir, surah_number, recognized_words, reference_words, 
                 word_spans, ayah_timestamps)
    
    return ayah_timestamps
```

**Proposed Implementation (Service-Based):**
```python
# In alignment_service.py
class AlignmentService:
    def __init__(self, quran_repository, output_service):
        self.quran_repository = quran_repository
        self.output_service = output_service
    
    def align_transcription(self, transcription, surah_number):
        # Get reference ayahs
        reference_ayahs = self.quran_repository.get_ayahs(surah_number)
        
        # Extract recognized words
        recognized_words = self._extract_recognized_words(transcription)
        
        # Extract reference words
        reference_words = self._extract_reference_words(reference_ayahs)
        
        # Align words
        word_spans = self._align_words(recognized_words, reference_words)
        
        # Extract ayah timestamps
        ayah_timestamps = self._extract_ayah_timestamps(
            word_spans, 
            reference_ayahs
        )
        
        # Save intermediate outputs
        self.output_service.save_alignment_artifacts(
            surah_number,
            recognized_words,
            reference_words,
            word_spans,
            ayah_timestamps
        )
        
        return ayah_timestamps
```

**Benefits:**
- Clear separation of concerns
- Easier to replace implementation details (e.g., different alignment algorithm)  
- Facilitates dependency injection for testing
- State managed by service instances rather than passed parameters

## Recommended Approach: Hybrid Architecture

I recommend a hybrid approach combining elements of object-oriented design and the pipeline pattern:

1. **Domain Objects** for key entities (Surah, Ayah, Transcription)
2. **Pipeline Pattern** for the overall processing flow
3. **Service-Based** for specialized operations (transcription, alignment)

### Example Implementation:

```python
# Domain Objects
class Surah:
    def __init__(self, number, audio_path):
        self.number = number
        self.audio_path = audio_path
        self.audio_data = None
        self.transcription = None
        self.ayah_timestamps = None
        self.ayahs = []
        
    def load_audio(self):
        # Load audio data using pydub
        # ...
        
class Transcription:
    def __init__(self, whisperx_result=None):
        self.text = ""
        self.word_segments = []
        self.whisperx_result = whisperx_result
        
    @property
    def recognized_words(self):
        # Extract recognized words from word_segments
        # ...

# Pipeline
class SurahProcessingPipeline:
    def __init__(self, config):
        self.config = config
        self.services = {
            "transcription": TranscriptionService(config),
            "alignment": AlignmentService(config),
            "audio": AudioService(config),
            "quran": QuranMetadataService(config)
        }
        
    def process_surah(self, surah_path):
        # Create surah object
        surah_number = self._extract_surah_number(surah_path)
        surah = Surah(surah_number, surah_path)
        
        # Load audio
        surah.load_audio()
        
        # Get reference ayahs
        reference_ayahs = self.services["quran"].get_ayahs(surah_number)
        
        # Transcribe audio
        surah.transcription = self.services["transcription"].transcribe(surah.audio_data)
        
        # Match ayahs to transcription
        surah.ayah_timestamps = self.services["alignment"].align_transcription(
            surah.transcription, 
            reference_ayahs
        )
        
        # Split audio by ayahs
        surah.ayahs = self.services["audio"].split_by_ayahs(
            surah.audio_data, 
            surah.ayah_timestamps
        )
        
        # Save outputs
        self._save_outputs(surah)
        
        return surah
```

## Implementation Strategy

To migrate from the current architecture to the proposed one, I recommend:

1. **Create Core Domain Models** (Surah, Ayah, Transcription)
2. **Refactor Services** from existing modules (transcription, alignment)
3. **Implement Pipeline** structure  
4. **Gradually Migrate** functionality from procedural to new architecture

## Conclusion

The proposed hybrid architecture offers several benefits over the current design:

1. **Reduced Parameter Passing**: Context objects and encapsulated services eliminate the need for long parameter chains
2. **Better Separation of Concerns**: Each component has clear responsibilities
3. **Improved Testability**: Services can be tested in isolation
4. **Enhanced Extensibility**: New processing stages can be added easily
5. **Better State Management**: State is managed through domain objects rather than function parameters

This architecture maintains the existing functionality while improving code organization and maintainability.
