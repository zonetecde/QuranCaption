import json
import argparse
import os


def process_quran(input_path):
    """
    This function reads a JSON file containing Quran data organized by surah and ayah,
    then creates a comprehensive word index that tracks the position of every word
    occurrence throughout the entire Quran.
    Args:
        input_path (str): Path to the JSON file containing Quran data. The JSON should
                         have the structure: {surah_num: {ayah_num: ayah_text, ...}, ...}
    Returns:
        dict: A dictionary where keys are words (str) and values are lists of dictionaries.
              Each inner dictionary contains occurrence information with keys:
              - "surah" (int): Surah number where the word appears
              - "ayah" (int): Ayah number where the word appears
              - "position_wrt_surah" (int): Position of word within the surah (1-indexed)
              - "position_wrt_quran" (int): Position of word within entire Quran (1-indexed)
    Example:
        >>> word_index = process_quran("quran.json")
        >>> word_index["بسم"]
        [
            {
                "surah": 1,
                "ayah": 1,
                "position_wrt_surah": 1,
                "position_wrt_quran": 1
            },
            {
                "surah": 11,
                "ayah": 41,
                "position_wrt_surah": 4,
                "position_wrt_quran": 28930
            }
        ]
    """
    # Load the Quran data
    with open(input_path, "r", encoding="utf-8") as file:
        quran_data = json.load(file)

    # Dictionary to store word positions
    word_index = {}

    # Global word position counter for the entire Quran
    position_wrt_quran = 1

    # Process each surah and ayah
    for surah_num, surah in quran_data.items():
        for ayah_num, ayah_text in surah.items():
            # Split the ayah into words
            words = ayah_text.split()

            # Process each word
            for position_wrt_surah, word in enumerate(words, 1):  # Position is 1-indexed
                # Add to the index
                if word not in word_index:
                    word_index[word] = []
                    # UNUSED LOGIC
                    # word_index[word] = {
                    #     "surah": [],
                    #     "ayah": [],
                    #     "position_wrt_surah": [],
                    #     "position_wrt_quran": [],
                    # }

                # Add occurrence information
                word_index[word].append(
                    {
                        "surah": int(surah_num),
                        "ayah": int(ayah_num),
                        "position_wrt_surah": position_wrt_surah,
                        "position_wrt_quran": position_wrt_quran,
                    }
                )
                # UNUSED LOGIC
                # # Append each property to its respective array
                # word_index[word]["surah"].append(int(surah_num))
                # word_index[word]["ayah"].append(int(ayah_num))
                # word_index[word]["position_wrt_surah"].append(position_wrt_surah)
                # word_index[word]["position_wrt_quran"].append(position_wrt_quran)

                # Increment global position counter
                position_wrt_quran += 1

    return word_index


def process_quran_list_implementation(input_path):
    """
    Reads a JSON file containing Quran data organized by surah and ayah,
    then creates a comprehensive word index that tracks the position of
    each word throughout the entire Quran.
    Args:
        input_path (str): Path to the JSON file containing Quran data.
                         Expected format: {surah_num: {ayah_num: ayah_text}}
    Returns:
        dict: Word index dictionary where each key is a word and each value
              contains arrays of positions where the word appears:
              {
                  "word": {
                      "surah": [list of surah numbers],
                      "ayah": [list of ayah numbers],
                      "position_wrt_surah": [list of positions within each surah],
                      "position_wrt_quran": [list of positions within entire Quran]
    Example:
        >>> word_index = process_quran("quran.json")
        >>> word_index["الله"]
        {
            "surah": [1, 1, 2],
            "ayah": [1, 2, 5],
            "position_wrt_surah": [1, 3, 7],
            "position_wrt_quran": [1, 15, 234]
        # This means "الله" appears:
        # - In surah 1, ayah 1, at position 1 in surah, position 1 in Quran
        # - In surah 1, ayah 2, at position 3 in surah, position 15 in Quran
        # - In surah 2, ayah 5, at position 7 in surah, position 234 in Quran
    """
    # Load the Quran data
    with open(input_path, "r", encoding="utf-8") as file:
        quran_data = json.load(file)

    # Dictionary to store word positions
    word_index = {}

    # Global word position counter for the entire Quran
    position_wrt_quran = 1

    # Process each surah and ayah
    for surah_num, surah in quran_data.items():
        for ayah_num, ayah_text in surah.items():
            # Split the ayah into words
            words = ayah_text.split()

            # Process each word
            for position_wrt_surah, word in enumerate(words, 1):  # Position is 1-indexed
                # Initialize the word entry if it doesn't exist
                if word not in word_index:
                    word_index[word] = {
                        "surah": [],
                        "ayah": [],
                        "position_wrt_surah": [],
                        "position_wrt_quran": [],
                    }

                # Append each property to its respective array
                word_index[word]["surah"].append(int(surah_num))
                word_index[word]["ayah"].append(int(ayah_num))
                word_index[word]["position_wrt_surah"].append(position_wrt_surah)
                word_index[word]["position_wrt_quran"].append(position_wrt_quran)

                # Increment global position counter
                position_wrt_quran += 1

    return word_index


def main():
    # Set up command line arguments
    parser = argparse.ArgumentParser(description="Create a word index from Quran JSON file")
    parser.add_argument("input_file", help="Path to the input Quran JSON file", nargs="?", default="")
    parser.add_argument("output_file", help="Path where the word index JSON will be saved", nargs="?", default="")

    args = parser.parse_args()

    # Process the Quran data
    if not args.input_file:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        input_filepath = os.path.join(current_dir, "surah_to_simple_ayahs.json")
    else:
        input_filepath = args.input_file

    word_index = process_quran(input_filepath)

    # If no output file is specified, use a default name
    if not args.output_file:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        output_filepath = os.path.join(current_dir, "quran_word_index.json")
    else:
        output_filepath = args.output_file

    # Write the output JSON file
    with open(output_filepath, "w", encoding="utf-8") as file:
        json.dump(word_index, file, ensure_ascii=False, indent=4)

    print(f"Word index successfully created at {output_filepath}")


if __name__ == "__main__":
    main()
