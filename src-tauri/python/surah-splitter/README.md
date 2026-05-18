# Surah Splitter (Service-Based Architecture)

This is the service-based implementation of the Surah Splitter project, designed to enhance modularity, support direct service access, and improve maintainability.

## Architecture Overview

The architecture organizes the system into distinct services, each responsible for a specific aspect of the processing pipeline:

1. **TranscriptionService**: Handles audio transcription using WhisperX
2. **AyahMatchingService**: Aligns transcribed words to reference Quranic text
3. **SegmentationService**: Splits audio files based on ayah timestamps
4. **QuranMetadataService**: Manages access to Quranic reference data
5. **PipelineService**: Orchestrates the complete processing pipeline

## Command-Line Usage

### Process a Surah (Full Pipeline)

```bash
python main_cli.py pipeline process -au "./data/input_surahs_to_split/adel_ryyan/076 Al-Insaan.mp3" -su 76 -re "adel_rayyan" -si -ssu
```

### Just Perform Transcription

```bash
python main_cli.py transcribe audio -au "./data/input_surahs_to_split/adel_ryyan/076 Al-Insaan.mp3" -o "./data/outputs/transcription.json"
```

### Match Pre-Transcribed Audio to Ayahs

```bash
python main_cli.py match ayahs -tf "./data/outputs/transcription.json" -su 76 -o "./data/outputs/timestamps.json"
```

### Segment Audio with Existing Timestamps

```bash
python main_cli.py segment audio -au "./data/input_surahs_to_split/adel_ryyan/076 Al-Insaan.mp3" -tf "./data/outputs/timestamps.json" -su 76 -re "adel_rayyan"
```
