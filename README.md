# dslop

Find duplicate code in your codebase.

```bash
npx dslop
```

By default, checks your branch changes (committed + uncommitted) against the codebase.

## Install

```bash
npm i -g dslop
```

## Usage

```bash
dslop                        # check your PR/branch for dupes
dslop --all                  # scan entire codebase
dslop ./src -m 6 -s 80       # 6 line min, 80% similarity  
dslop --all --cross-package  # cross-package dupes (monorepos)
```

## Options

| Flag | Description |
|------|-------------|
| `-a, --all` | scan entire codebase (default: uncommitted only) |
| `-m, --min-lines` | min lines per block (default: 4) |
| `-s, --similarity` | similarity threshold 0-100 (default: 70) |
| `-e, --extensions` | file extensions (default: ts,tsx,js,jsx) |
| `--cross-package` | only show dupes across packages |
| `--json` | json output |

## How it works

dslop uses two detection methods in parallel:

### 1. AST-based detection (functions/classes)

Parses TypeScript/JavaScript with Babel to extract functions and classes. Normalizes the AST by replacing all identifiers with generic placeholders (`$0`, `$1`, etc.), preserving only the code structure.

**This catches:**
- Functions with identical logic but different variable names
- Renamed copies of existing functions
- Structurally identical classes

Example: `calculateSum(numbers)` and `computeTotal(items)` with the same loop structure will match.

### 2. Text-based detection (code blocks)

Sliding window over source files extracts overlapping blocks at sizes 4, 6, 9, 13... lines. Before hashing, code is normalized:
- String literals → `"<STRING>"`
- Numbers → `<NUMBER>`
- Whitespace collapsed
- Comments preserved (intentional - comments often indicate copy-paste)

Exact hash matches = exact duplicates. For similar (non-exact) matches, uses character-level similarity.

### Changed-line filtering (default mode)

Parses `git diff` output to get exact line ranges of your changes. Only reports duplicates where your changed lines match code elsewhere in the codebase.

### Declaration detection (`--all` mode)

Regex-based extraction of types, interfaces, enums. Compares by name similarity (Levenshtein + word overlap) and content similarity.

## Limitations

- **TypeScript/JavaScript only for AST:** AST parsing uses Babel with TS/JSX plugins. Other languages fall back to text-based only.
- **No cross-language:** Won't detect a Python function duplicated in TypeScript.
- **Comments affect text matching:** Intentional tradeoff. Copy-pasted code often includes comments.
- **Declaration detection is regex:** Can miss edge cases like multi-line generics or decorators.
- **Minimum 4 lines:** Shorter duplicates ignored to reduce noise. Use `-m 2` for stricter.
- **Memory:** Loads all blocks in memory. Very large codebases (>1M lines) may be slow.

## License

MIT
