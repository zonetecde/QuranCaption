# Define paths using the project path as the root

from pathlib import Path

# Define the root path of the project
# NOTE: change this if this file location's changes
PROJECT_ROOT_PATH = Path(__file__).resolve().parent.parent.parent.parent

SURAH_INPUTS_PATH = PROJECT_ROOT_PATH / "data" / "input_surahs_to_split"
QURAN_METADATA_PATH = PROJECT_ROOT_PATH / "data" / "quran_metadata"
OUTPUTS_PATH = PROJECT_ROOT_PATH / "data" / "outputs"
LOGS_PATH = PROJECT_ROOT_PATH / "logs"
