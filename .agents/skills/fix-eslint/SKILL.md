---
name: fix-eslint
description: Automatically fix ESLint errors by modifying code to comply with linting rules. For small codebases (≤20 errors), fixes directly. For larger codebases (>20 errors), spawns parallel agents per directory for efficient processing. Never disables rules or adds ignore comments.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, TodoWrite
---

# Fix ESLint Errors

Automatically fix ESLint errors by modifying code to comply with configured linting rules.

**Priorities:**
1. **Never bypass rules** - No eslint-disable comments, no rule modifications
2. **Fix code to comply** - Modify implementation to meet linting standards
3. **Preserve functionality** - Ensure fixes don't break existing behavior
4. **Follow coding standards** - Apply fixes aligned with project style (FP-first, explicit naming)

## Workflow

### Step 1: Analyze ESLint Errors

Run the analysis script to understand error distribution:

```bash
bash ./.claude/skills/fix-eslint/scripts/analyze_errors.sh
```

Or with file pattern:
```bash
bash ./.claude/skills/fix-eslint/scripts/analyze_errors.sh "src/**/*.ts"
```

This outputs:
- Total error count
- Files grouped by directory
- Directory-level breakdown

### Step 2: Choose Strategy

**If ≤20 errors:** Proceed to Step 3 (Direct Fix)
**If >20 errors:** Proceed to Step 4 (Parallel Fix)

---

## Step 3: Direct Fix (≤20 errors)

For small error counts, fix directly without spawning agents.

### Process

1. **Run ESLint to get errors:**
   ```bash
   pnpm lint [file-or-directory]
   ```

2. **For each file with errors:**
   - Read the file
   - Identify each ESLint error (rule name, line number, message)
   - Fix by modifying code to comply with the rule
   - **NEVER** add `eslint-disable` comments or modify ESLint config
   - See `./guidelines.md` for detailed fixing guidelines

3. **Verify each fix:**
   ```bash
   pnpm lint <file-path>
   ```

4. **Repeat** until all errors fixed

### Report

At the end, provide:
- List of files processed
- Total errors fixed
- Brief summary (e.g., "8 unused imports removed, 3 return types added, 2 const conversions")
- Any remaining errors (if unable to fix automatically)

---

## Step 4: Parallel Fix (>20 errors)

For large error counts, orchestrate parallel fix-eslint agents by directory.

⚠️ **CRITICAL: Follow steps IN ORDER. DO NOT skip ahead.**

### 4.1: Group Files by Directory and Create Todos (BLOCKING)

⚠️ **MUST complete before Step 4.2**

**Use the output from Step 1** (the analyze_errors.sh script) to create directory-to-files mapping:
- `src/auth/` → [login.ts, register.ts, session.ts]
- `src/api/` → [users.ts, posts.ts]
- `src/components/` → [Button.tsx, Header.tsx, Footer.tsx]

**Grouping rules:**
- Group files by immediate parent directory
- If directory has 10+ files, consider splitting into sub-directories or smaller batches
- If all errors in 1 file, skip parallelization and use Step 3 instead

Use TodoWrite to create one todo per directory:

```javascript
TodoWrite: [
  {content: "Fix ESLint errors in src/auth/", activeForm: "Fixing ESLint errors in src/auth/", status: "pending"},
  {content: "Fix ESLint errors in src/api/", activeForm: "Fixing ESLint errors in src/api/", status: "pending"},
  {content: "Fix ESLint errors in src/components/", activeForm: "Fixing ESLint errors in src/components/", status: "pending"}
]
```

✅ **CHECKPOINT: Verify all todos created before Step 4.2**

### 4.2: Spawn Parallel Agents (ONLY AFTER Step 4.1 Complete)

⚠️ **DO NOT START until Step 4.1 fully complete**

Update all todos to in_progress:
```javascript
TodoWrite: [
  {content: "Fix ESLint errors in src/auth/", activeForm: "Fixing ESLint errors in src/auth/", status: "in_progress"},
  {content: "Fix ESLint errors in src/api/", activeForm: "Fixing ESLint errors in src/api/", status: "in_progress"},
  {content: "Fix ESLint errors in src/components/", activeForm: "Fixing ESLint errors in src/components/", status: "in_progress"}
]
```

**IMPORTANT:** Spawn ALL agents in SINGLE message using multiple Task tool calls.

**Example Task invocations:**

```markdown
Task 1 (src/auth/):
prompt: "Fix all ESLint errors in the src/auth/ directory.

Files with errors:
- src/auth/login.ts
- src/auth/register.ts
- src/auth/session.ts

See ./.claude/skills/fix-eslint/guidelines.md for detailed guidelines.

Process:
1. For each file, run: pnpm lint <file-path>
2. Read the file with errors
3. Fix each error by modifying code to comply with rule
4. NEVER add eslint-disable comments or modify eslint config
5. Verify: run pnpm lint <file-path> again to confirm fix

Report back:
- List of files processed
- Total errors fixed
- Brief summary (e.g., '8 unused imports removed, 3 return types added')
- Any remaining errors (if unable to fix)"

subagent_type: "general-purpose"
description: "Fix auth directory ESLint errors"
```

```markdown
Task 2 (src/api/):
prompt: "Fix all ESLint errors in the src/api/ directory.

Files with errors:
- src/api/users.ts
- src/api/posts.ts

See ./.claude/skills/fix-eslint/guidelines.md for detailed guidelines.

Process:
1. For each file, run: pnpm lint <file-path>
2. Read the file with errors
3. Fix each error by modifying code to comply with rule
4. NEVER add eslint-disable comments or modify eslint config
5. Verify: run pnpm lint <file-path> again to confirm fix

Report back:
- List of files processed
- Total errors fixed
- Brief summary of main fixes
- Any remaining errors"

subagent_type: "general-purpose"
description: "Fix API directory ESLint errors"
```

**Continue pattern for all directory batches...**

Claude Code manages parallelism (up to 10 tasks concurrently).

### 4.3: Track Agent Completion and Update Todos

As each agent completes:

1. Parse agent's report (files processed, errors fixed)
2. Update corresponding todo to completed:

```javascript
TodoWrite: [
  {content: "Fix ESLint errors in src/auth/", activeForm: "Fixing ESLint errors in src/auth/", status: "completed"},
  {content: "Fix ESLint errors in src/api/", activeForm: "Fixing ESLint errors in src/api/", status: "in_progress"},
  {content: "Fix ESLint errors in src/components/", activeForm: "Fixing ESLint errors in src/components/", status: "in_progress"}
]
```

3. Repeat for each agent as they complete

### 4.4: Final Verification and Summary

After ALL agents complete:

1. **Run final verification:**
   ```bash
   pnpm lint 2>&1
   ```

2. **Aggregate results from all agent reports:**
   ```
   Summary:
   - Total directories processed: X
   - Total files modified: Y
   - Total errors fixed: Z
   - Breakdown by directory:
     • src/auth/: 12 errors fixed in 3 files
     • src/api/: 8 errors fixed in 2 files
     • src/components/: 15 errors fixed in 3 files
   - Remaining errors: N (if any)
   ```

3. If remaining errors exist, report which files/directories still have issues

---

## Edge Cases

**Only 1 file with errors:**
- Skip parallelization
- Fix directly using Step 3
- No TodoWrite needed

**Errors spread across many directories (15+):**
- Group by top-level directory only (e.g., `src/`, `tests/`, `lib/`)
- Don't over-split - let Claude Code manage parallelism

**Large directory (20+ files):**
- Split by subdirectory if they exist
- Or batch into groups of ~5 files each with separate Task calls

**Agent reports remaining errors:**
- Include in final summary
- Note specific files/rules that couldn't be auto-fixed
- Suggest manual review

---

## Conflict Prevention

- Each directory/file assigned to EXACTLY ONE agent
- Verify no overlap before spawning
- All Task calls in ONE message for parallel execution
- Never let two agents modify same file

---

## Guidelines Reference

For detailed fixing guidelines, constraints, and patterns, see:
- `./guidelines.md` - Complete fixing rules and process
