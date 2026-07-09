# Minimal implementation rules

When implementing a feature, always prefer the smallest correct change.

Rules:

- Write as little code as possible.
- Reuse existing helpers, hooks, utilities, components, and patterns before creating anything new.
- Do not introduce new abstractions unless they are strictly necessary.
- Do not rename, move, or refactor unrelated code.
- Keep the diff as small as possible.
- Prefer modifying existing files over creating new ones.
- Avoid adding dependencies unless absolutely required.
- Preserve current behavior outside the requested feature.
- Follow the existing code style and architecture of the repository.
- Always read and write files as UTF-8.
- Always localize new or changed user-facing text in all supported languages before finishing.
- Use `$lib/i18n/i18n-svelte` (`LL`) and `get(LL)` to resolve displayed strings — never hardcode
  user-facing text.
- Do not run the i18n type generation command manually. It is executed by the pre-commit hook.
- After the pre-commit hook runs the i18n generation command, assume generated i18n files are
  correct and do not inspect or double-check them unless there is a concrete error to fix.
- When implementing a feature that mutates project state (style changes, clip edits, translations,
  etc.), always wrap it with `ProjectHistoryManager` (`.track()`, `.begin()`/`.commit()`, or
  `.trackAsync()`) so it supports undo/redo.
- Before adding, moving, renaming, or changing a video style or its editor layout, read
  `documentations/style-json.md` and follow its JSON metadata, localization, dependency, undo/redo,
  and migration checklist.
- Stop at the requested scope. Do not add extra improvements.
- When several solutions are possible, choose the most minimal one that is correct and maintainable.

Before coding:

- Briefly identify the smallest viable approach.

When done:

- Summarize exactly what changed.
- Mention why this was the most minimal valid implementation.
- Suggest 2 commit messages for the work:
  - 1 in English
  - 1 in French
- Keep both commit messages short, clear, and natural.
- Prefer conventional commit style when it fits (for example: `fix(...)`, `feat(...)`,
  `refactor(...)`).
- Make sure both commit messages describe the actual change, not a vague intention.

Code quality requirements:

- Add docstrings to every new function created.
- Use JSDoc-style docstrings when applicable (with explicit types in `@param` and `@returns`).
- Write all docstrings in the language of the others docstring.
- Add inline comments in the language of the other comments when the logic is not immediately
  obvious.
- Keep comments concise and useful (no obvious comments).

Example:

- English: `fix(export): black glitches are now gone`
- French: `fix(export): suppression du glitch des vidéos noires`
