"""Build Cython extensions (DP alignment core)."""

from setuptools import setup, Extension
from Cython.Build import cythonize

extensions = [
    Extension(
        "src.alignment._dp_core",
        ["src/alignment/_dp_core.pyx"],
    ),
]

setup(
    ext_modules=cythonize(extensions, language_level="3"),
)
