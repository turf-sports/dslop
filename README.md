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

**Block extraction:** Sliding window over source files. Extracts overlapping blocks at sizes 4, 6, 9, 13... lines. For blocks <10 lines, step=1 (every line). Larger blocks use step=blockSize/2.

**Normalization:** Before hashing, code is normalized:
- String literals → `"<STRING>"`
- Numbers → `<NUMBER>`
- Whitespace collapsed
- Comments preserved (intentional - comments often indicate copy-paste)

**Matching:** Normalized blocks are hashed. Exact hash matches = exact duplicates. For similar (non-exact) matches, uses character-level similarity on a sample of blocks per hash bucket.

**Declaration detection** (`--all` mode): Regex-based extraction of types, interfaces, functions, classes. Compares by name similarity (Levenshtein + word overlap) and content similarity.

**Changed-line filtering** (default mode): Parses `git diff` output to get exact line ranges. Only reports duplicates where your changed lines match code elsewhere.

## Limitations

- **Text-based, not AST:** Doesn't understand code structure. A reformatted function won't match the original. Two semantically identical functions with different variable names won't match.
- **TypeScript/JavaScript focused:** Default extensions are ts/tsx/js/jsx. Works on any text but tuned for JS-like syntax.
- **No cross-language:** Won't detect a Python function duplicated in TypeScript.
- **Comments affect matching:** Intentional tradeoff. Copy-pasted code often includes comments.
- **Declaration detection is regex:** Can miss edge cases like multi-line generics or decorators.
- **Minimum 4 lines:** Shorter duplicates ignored to reduce noise. Use `-m 2` for stricter.
- **Memory:** Loads all blocks in memory. Very large codebases (>1M lines) may be slow.

## License

MIT
