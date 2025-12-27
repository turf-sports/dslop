# dslop

Find duplicate code in your codebase.

```bash
npx dslop .
```

## Install

```bash
npm i -g dslop
```

## Usage

```bash
dslop .                      # scan current directory
dslop --staged               # check uncommitted changes for dupes
dslop ./src -m 6 -s 80       # 6 line min, 80% similarity  
dslop . --cross-package      # only cross-package dupes (monorepos)
dslop . --json               # json output
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --min-lines` | 4 | min lines per block |
| `-s, --similarity` | 70 | similarity threshold (0-100) |
| `-e, --extensions` | ts,tsx,js,jsx | file extensions |
| `--staged` | | only show dupes involving uncommitted changes |
| `--cross-package` | | only show dupes across packages |
| `--json` | | json output |

## License

MIT
