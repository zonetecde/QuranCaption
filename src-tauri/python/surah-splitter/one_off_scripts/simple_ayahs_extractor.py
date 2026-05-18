import csv
import json
import re
from pathlib import Path

# Define the root path of the project to locate the CSV and output JSON
PROJECT_ROOT_PATH = Path(__file__).resolve().parent.parent
QURAN_CSV_PATH = PROJECT_ROOT_PATH / "data" / "quran_metadata" / "Quran_Arabic.csv"
OUTPUT_JSON_PATH = PROJECT_ROOT_PATH / "data" / "quran_metadata" / "surah_to_simple_ayahs.json"


# This is a copy of the clean_text function from ayah_matcher.py
def clean_text(text: str) -> str:
    """Clean Arabic text by removing diacritics and non-Arabic characters."""
    # Keep only specified Arabic letters and spaces
    # Check this for details:
    #   https://jrgraphix.net/r/Unicode/0600-06FF
    text = re.sub(r"[^\u060f\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\s]", "", text)

    # Normalize spaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def create_surah_to_simple_ayahs_json():
    """
    Reads the Quran_Arabic.csv file, processes the AyahText,
    and outputs a JSON file named surah_to_simple_ayahs.json
    in the src/surah_splitter/quran_toolkit/ directory.
    """
    surah_data = {}
    # Note the trailing space (this will allow first bismilla ayah NOT to be removed)
    bismillah_prefix = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ "

    if not QURAN_CSV_PATH.exists():
        print(f"Error: Quran CSV file not found at {QURAN_CSV_PATH}")
        return

    with open(QURAN_CSV_PATH, mode="r", encoding="utf-8-sig") as csvfile:  # Use utf-8-sig to handle BOM
        reader = csv.DictReader(csvfile)
        for row in reader:
            try:
                sura_id_str = row["SuraID"]
                verse_id_str = row["VerseID"]
                ayah_text = row["AyahText"]

                if not sura_id_str or not verse_id_str:
                    print(f"Skipping row due to missing SuraID or VerseID: {row}")
                    continue

                # Remove Bismillah prefix if present
                if ayah_text.startswith(bismillah_prefix):
                    processed_text = ayah_text[len(bismillah_prefix) :]
                else:
                    processed_text = ayah_text

                # Clean the text
                cleaned_text = clean_text(processed_text)

                if sura_id_str not in surah_data:
                    surah_data[sura_id_str] = {}
                surah_data[sura_id_str][verse_id_str] = cleaned_text
            except KeyError as e:
                print(f"Skipping row due to missing key {e}: {row}")
                continue
            except Exception as e:
                print(f"Error processing row {row}: {e}")
                continue

    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as jsonfile:
        json.dump(surah_data, jsonfile, ensure_ascii=False, indent=4)

    print(f"Successfully created {OUTPUT_JSON_PATH}")


if __name__ == "__main__":
    create_surah_to_simple_ayahs_json()
