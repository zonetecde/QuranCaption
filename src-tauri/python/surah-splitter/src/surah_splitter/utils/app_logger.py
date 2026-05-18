"""
Application-wide logging utility based on Loguru.

This module provides a simple, configurable logger for the Surah Splitter project.
It uses Loguru for rich, structured logging with minimal setup but powerful features.
"""

from pathlib import Path
import sys
import inspect
from typing import Optional, Union
from loguru import logger


def setup_logger(
    log_file: Optional[Union[str, Path]] = None,
    log_level: str = "DEBUG",
    rotation: str = "10 MB",
    retention: str = "1 week",
    format_string: Optional[str] = None,
) -> None:
    """
    Configure the logger for the application.

    Args:
        log_file: Path to log file. If None, logs only go to stderr.
        log_level: Minimum level for logging messages.
        rotation: When to rotate the log file (e.g., "10 MB", "1 day")
        retention: How long to keep log files (e.g., "1 week", "30 days")
        format_string: Format string for log messages. If None, a default format is used.

    Returns:
        None
    """

    # Define filter to use bound values if available
    def file_line_function_filter(record):
        """Filter to set file, line and function attributes from extras if available."""
        # If extras contain our custom values, use them instead of the default ones
        if "file" in record["extra"]:
            record["file"] = record["extra"]["file"]
        if "line" in record["extra"]:
            record["line"] = record["extra"]["line"]
        if "function" in record["extra"]:
            record["function"] = record["extra"]["function"]
        return record

    # First, remove any existing handlers
    logger.remove()

    # Default format string for structured yet readable logs
    if format_string is None:
        # Define format components as string variables
        time_format = "<green>{time:YYYY-MM-DD HH:mm:ss}</green>"
        level_format = "<level>{level}</level>"

        # NOTE: Even though `{file}` is a dict that contains `name` and `path` keys, if we use it directly,
        #   it will just show the `name` of the file, which is what we want.
        file_format = "<blue>{file}</blue>"

        line_format = "<cyan>{line}</cyan>"
        function_format = "<magenta>[{function}()]</magenta>"
        message_format = "<level>{message}</level>"

        # Combine using f-string
        format_string = f"{time_format} | {level_format} | {file_format}:{line_format} {function_format} | {message_format}"

    # Add stderr handler
    logger.add(
        sys.stderr,
        level=log_level,
        format=format_string,
        colorize=True,
        filter=file_line_function_filter,
    )

    # Add file handler if log_file is provided
    if log_file:
        # Convert to Path if it's a string
        if isinstance(log_file, str):
            log_file = Path(log_file)

        # Ensure parent directory exists
        log_file.parent.mkdir(parents=True, exist_ok=True)

        logger.add(
            str(log_file),
            level=log_level,
            format=format_string,
            rotation=rotation,
            retention=retention,
            compression="zip",
            encoding="utf-8",
            filter=file_line_function_filter,
        )


# Create a context manager to track timing of operations
class LoggerTimingContext:
    """Context manager for timing operations and logging the duration."""

    def __init__(self, operation_name: str, level: str = "DEBUG", succ_log: bool = False, start_log: bool = True):
        """
        Initialize a new timing context.

        Args:
            operation_name: Name of the operation being timed
            level: Log level to use when logging the timing (default: DEBUG)
            succ_log: Whether to use SUCCESS level when operation completes
            start_log: Whether to show a log when the operation starts
        """
        self.operation_name = operation_name
        self.level = level
        self.succ_log = succ_log
        self.start_log = start_log

        # Capture caller information
        current_frame = inspect.currentframe()
        caller_frame = inspect.getouterframes(current_frame, 2)
        self.caller_file = Path(caller_frame[1].filename).name
        self.caller_line = caller_frame[1].lineno
        self.caller_function = caller_frame[1].function

        # Create a bound logger with caller information
        self.bound_logger = logger.bind(file=self.caller_file, line=self.caller_line, function=self.caller_function)

    def __enter__(self):
        """Start the timer when entering the context."""
        import time

        self.start_time = time.time()
        if self.start_log:
            self.bound_logger.log(self.level, f'Started: "{self.operation_name}"')
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Log the elapsed time when exiting the context."""
        import time

        elapsed = time.time() - self.start_time

        # Format elapsed time as seconds, minutes, or hours
        if elapsed < 60:  # Less than a minute
            time_str = f"{elapsed:.2f}s"
        elif elapsed < 3600:  # Less than an hour
            time_str = f"{elapsed / 60:.2f}m"
        else:  # Hours or more
            time_str = f"{elapsed / 3600:.2f}h"

        if exc_type:
            self.bound_logger.error(f'Operation "{self.operation_name}" failed after {time_str}: {exc_val}')
        else:
            log_level = "SUCCESS" if self.succ_log else self.level
            self.bound_logger.opt(colors=True).log(
                log_level, f'<magenta>[⏳ {time_str}]</magenta> Finished: "{self.operation_name}"'
            )


# Initialize the logger with default settings at import time
# This can be reconfigured later using setup_logger() if needed
setup_logger()

# Usage examples in the project:
# logger.debug("Detailed debug information")
# logger.info("Normal processing events")
# logger.success("Operation completed successfully")
# logger.warning("Something might cause issues")
# logger.error("Something failed but execution continues")
# logger.critical("Application is about to crash or has a significant issue")
# logger.exception("Log an exception with traceback")

# This allows importing the logger directly from this module
__all__ = ["logger", "setup_logger"]
