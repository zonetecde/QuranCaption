"""
Utility functions for file operations.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional, TypeVar, List

from surah_splitter.utils.app_logger import logger

# Type variable for generic return type
T = TypeVar("T", Dict[str, Any], List[Any])


def save_json(
    data: Dict[str, Any],
    output_dir: Path,
    filename: str,
    ensure_dir: bool = True,
    encoding: str = "utf-8",
    indent: int = 4,
    log_message: Optional[str] = None,
) -> Path:
    """
    Save intermediate JSON data to a file in the output directory.

    Args:
        data: Dictionary data to save as JSON
        output_dir: Directory to save the file in
        filename: Name of the file to save
        ensure_dir: Whether to create the directory if it doesn't exist
        encoding: File encoding to use
        indent: JSON indentation level
        log_message: Optional custom log message, uses default if None

    Returns:
        Path to the saved file
    """
    # Create directory if it doesn't exist and ensure_dir is True
    if ensure_dir:
        output_dir.mkdir(parents=True, exist_ok=True)

    # Construct file path
    file_path = output_dir / filename

    # Log the operation
    log_msg = log_message or f"Saving file to: {file_path}"
    logger.debug(log_msg)

    # Write the file
    with open(file_path, "w", encoding=encoding) as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)

    return file_path


def load_json(file_path: Path, encoding: str = "utf-8") -> T:
    """
    Load JSON data from a file.

    Args:
        file_path: Path to the JSON file
        encoding: File encoding to use

    Returns:
        Loaded JSON data

    Raises:
        FileNotFoundError: If the file doesn't exist
        json.JSONDecodeError: If the file contains invalid JSON
    """
    logger.debug(f"Loading JSON from: {file_path}")

    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    with open(file_path, "r", encoding=encoding) as f:
        data = json.load(f)

    return data
