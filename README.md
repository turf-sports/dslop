# dslop

**D**etect **S**imilar/**L**ines **O**f **P**rogramming - A fast duplicate code detector.

## Installation

```bash
bun install
```

## Usage

```bash
# Scan current directory
bun run index.ts .

# Scan specific directory with options
bun run index.ts ./src -m 6 -s 80

# Output as JSON
bun run index.ts . --json
```

## Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--min-lines` | `-m` | 4 | Minimum block size in lines |
| `--similarity` | `-s` | 70 | Minimum similarity threshold (0-100) |
| `--extensions` | `-e` | ts,tsx,js,jsx | File extensions to scan |
| `--ignore` | `-i` | node_modules,dist,... | Patterns to ignore |
| `--no-normalize` | | | Disable string/number normalization |
| `--json` | | | Output as JSON |
| `--help` | `-h` | | Show help |
| `--version` | `-v` | | Show version |

## How It Works

1. **Scanning**: Recursively scans files matching the specified extensions
2. **Block Extraction**: Extracts code blocks using a sliding window approach at multiple granularities
3. **Normalization**: Replaces string literals, numbers, and colors with placeholders for structural comparison
4. **Hash Grouping**: Groups exact duplicates by hash for fast matching
5. **Similarity Matching**: Uses Jaccard similarity on line sets for near-duplicates
6. **Filtering**: Removes overlapping blocks and deduplicates groups

## Configuration

All detection parameters are configurable in `src/constants.ts`:

```typescript
// Block extraction
MAX_BLOCK_SIZE = 100           // Maximum lines per block
BLOCK_SIZE_MULTIPLIER = 1.5    // Growth factor for multi-size extraction
MIN_MEANINGFUL_LINE_RATIO = 0.6 // Skip blocks with too many comments/whitespace

// Detection
SIZE_BUCKET_DIVISOR = 5        // Group blocks by ~5 line buckets
MAX_BLOCKS_FOR_SIMILARITY = 10000 // Skip similarity for large codebases
GROUP_OVERLAP_THRESHOLD = 0.5  // Dedup threshold

// Output
MAX_GROUPS_DETAILED = 20       // Max groups to show in detail
MAX_MATCHES_IN_SUMMARY = 5     // Max file matches per group
```

## Example Output

```
Scanning ./src...
  Extensions: ts, tsx, js, jsx
  Min block size: 4 lines
  Similarity threshold: 70%
  Normalization: enabled

Scanned 81 files (15,672 lines) in 129ms
Extracted 13,920 code blocks

Found 500 duplicate groups in 51ms

────────────────────────────────────────────────────────────────────────────────
DUPLICATE CODE DETECTED
────────────────────────────────────────────────────────────────────────────────

Group 1 │ EXACT │ 28 lines × 2 occurrences = 56 lines of duplication

  ├─ QuarterlyWinnerMessagePreview.tsx:197-224
  ├─ CoachEnteredMessagePreview.tsx:113-140

  Code preview:
  │ <View style={{
  │   backgroundColor: "white",
  │   ...

SUMMARY
────────────────────────────────────────────────────────────────────────────────
  Total duplicate groups:    500
  Exact matches:             450
  Similar matches:           50
  Files affected:            65
  Total duplicate lines:     12,340
  Average similarity:        95%
```

## Build

```bash
# Create standalone binary
bun build --compile ./index.ts --outfile dslop
```

## License

MIT
