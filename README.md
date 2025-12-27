# dslop

**D**etect **S**imilar/**L**ines **O**f **P**rogramming - A fast duplicate code detector.

## Quick Start

Run instantly with npx (no install required):

```bash
npx dslop .
```

## Installation

```bash
# Install globally
npm install -g dslop

# Or with other package managers
pnpm add -g dslop
bun add -g dslop
yarn global add dslop
```

## Usage

```bash
# Scan current directory
dslop .

# Scan specific directory with options
dslop ./src -m 6 -s 80

# Only show duplicates across packages (great for monorepos)
dslop . --cross-package

# Output as JSON
dslop . --json
```

Or run without installing:

```bash
npx dslop .
bunx dslop .
pnpm dlx dslop .
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

## Monorepo Mode

Use `--cross-package` to find duplicates that span across different packages/apps - perfect for identifying code that should be moved to a shared library:

```bash
dslop . --cross-package
```

This filters results to only show duplicates where occurrences are in different `apps/`, `packages/`, or `libs/` directories.

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

## Development

```bash
# Clone and install
git clone https://github.com/turf-sports/dslop.git
cd dslop
bun install

# Run in dev mode
bun run dev

# Build for npm
bun run build

# Create standalone binary
bun run build:binary
```

## License

MIT
