# dslop

Find duplicate code in your codebase.

```bash
npx dslop
```

By default, checks your uncommitted changes against the codebase.

## Install

```bash
npm i -g dslop
```

## Usage

```bash
dslop                        # check uncommitted changes for dupes
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

## License

MIT
