"""Phonemizer integration for reference phonemes."""

_pm = None


def get_phonemizer():
    """Get or create Phonemizer instance."""
    global _pm
    if _pm is None:
        from quranic_phonemizer import Phonemizer
        _pm = Phonemizer()
    return _pm


def phonemize_with_stops(pm, ref: str, stops):
    """Call Phonemizer.phonemize with backward/forward compatible stop args."""
    try:
        return pm.phonemize(ref=ref, stops=stops)
    except TypeError as exc:
        if "unexpected keyword argument 'stops'" not in str(exc):
            raise
        return pm.phonemize(ref=ref, stop_signs=stops)
