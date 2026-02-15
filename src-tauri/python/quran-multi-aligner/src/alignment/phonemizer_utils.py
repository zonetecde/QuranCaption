"""Phonemizer integration for reference phonemes."""

_pm = None


def get_phonemizer():
    """Get or create Phonemizer instance."""
    global _pm
    if _pm is None:
        from core.phonemizer import Phonemizer
        _pm = Phonemizer()
    return _pm
