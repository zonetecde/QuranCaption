#!/usr/bin/env bash
# Parse ESLint output and group files by directory

set -euo pipefail

# Optional file pattern argument
FILE_PATTERN="${1:-}"

# Run ESLint and capture output
if [ -n "$FILE_PATTERN" ]; then
  LINT_OUTPUT=$(pnpm lint "$FILE_PATTERN" 2>&1 || true)
else
  LINT_OUTPUT=$(pnpm lint 2>&1 || true)
fi

# Extract unique files with errors
FILES_WITH_ERRORS=$(echo "$LINT_OUTPUT" | grep -E "^\s*/" | sed 's/\s*[0-9]*:[0-9]*.*//' | sort -u)

# Count total errors
TOTAL_ERRORS=$(echo "$LINT_OUTPUT" | grep -E "^\s*/" | wc -l | tr -d ' ')

# Exit if no errors
if [ -z "$FILES_WITH_ERRORS" ] || [ "$TOTAL_ERRORS" -eq 0 ]; then
  echo "No ESLint errors found"
  exit 0
fi

echo "Total ESLint errors: $TOTAL_ERRORS"
echo ""

# Group files by parent directory
echo "Files by directory:"
echo "$FILES_WITH_ERRORS" | xargs -n1 dirname | sort | uniq -c | while read -r count dir; do
  echo "  $dir: $count files"
done

echo ""
echo "Directory groupings (for parallel processing):"
echo "$FILES_WITH_ERRORS" | xargs -n1 dirname | sort -u | while read -r dir; do
  echo "Directory: $dir"
  echo "$FILES_WITH_ERRORS" | grep "^$dir/" | sed 's/^/  - /'
  echo ""
done
