# dslop

Find duplicate functions, types, and code in your codebase using AST analysis.

```bash
npx dslop
```

## What it finds

**Real duplicates, not noise.** dslop uses AST parsing to find semantically identical code - functions with the same logic but different variable names, types defined in multiple places, copy-pasted utilities.

```bash
$ dslop --all --json

{
  "summary": { "duplicateGroups": 101 },
  "duplicates": [
    {
      "type": "function",
      "name": "loadEnv",
      "occurrences": 6,
      "locations": [
        { "name": "loadEnv", "file": "scripts/migrate.ts", "line": 8 },
        { "name": "loadEnv", "file": "scripts/seed.ts", "line": 12 },
        { "name": "loadEnv", "file": "lib/db/migrate.ts", "line": 7 },
        { "name": "loadEnv", "file": "lib/db/check-state.ts", "line": 9 }
      ]
    },
    {
      "type": "interface",
      "name": "Params",
      "occurrences": 6,
      "locations": [
        { "name": "Params", "file": "app/api/games/[id]/route.ts", "line": 5 },
        { "name": "Params", "file": "app/api/games/[id]/state/route.ts", "line": 8 },
        { "name": "Params", "file": "app/api/games/[id]/details/route.ts", "line": 12 }
      ]
    },
    {
      "type": "type",
      "name": "LeaderboardPlayer",
      "occurrences": 3,
      "locations": [
        { "name": "LeaderboardPlayer", "file": "packages/types/leaderboard.ts", "line": 45, "exported": true },
        { "name": "LeaderboardPlayer", "file": "apps/mobile/types.ts", "line": 52, "exported": false },
        { "name": "LeaderboardPlayer", "file": "apps/web/lib/types.ts", "line": 30, "exported": false }
      ]
    }
  ]
}
```

### Monorepo cross-package duplicates

Find types and functions duplicated across packages:

```bash
$ dslop --all --cross-package

Found 48 duplicate functions/types

# Types duplicated between packages/types and apps/
PrizeDistribution    packages/types/game.ts ↔ packages/db/schema/game.ts
DevicePlatform       apps/web/lib/notifications.ts ↔ apps/listener/lib/notifications.ts
TeamColors           apps/mobile/store/types.ts ↔ apps/web/lib/types/colors.ts

# Functions copy-pasted between apps/
subscribeToChannel   apps/web/lib/subscriptions.ts ↔ apps/listener/lib/subscriptions.ts
getTeamLogoUrl       packages/shared/logos.ts → also in apps/web (3 copies)
normalizeError       apps/web/sentry.config.ts ↔ apps/listener/lib/sentry.ts
```

### PR review mode

By default, dslop checks your branch changes against the existing codebase:

```bash
$ dslop

Scanning...
  Mode: checking changed lines in 3 files

Found 2 duplicate functions/types

# You're adding code that already exists elsewhere:
getUserDisplayName   your change: app/profile/page.tsx:19
                     exists in: components/sidebar.tsx:50
```

## Install

```bash
npm i -g dslop
```

## Usage

```bash
dslop                        # check PR changes (or full scan if none)
dslop --all                  # full codebase scan
dslop --all --json           # JSON output for tooling
dslop --cross-package        # only cross-package dupes (monorepos)
dslop ./apps/web             # scan specific directory
```

## Options

| Flag | Description |
|------|-------------|
| `-a, --all` | force full codebase scan |
| `-c, --changes` | force changes-only mode (exit if no changes) |
| `-m, --min-lines` | min lines per block (default: 4) |
| `-s, --similarity` | similarity threshold 0-100 (default: 70) |
| `-e, --extensions` | file extensions (default: ts,tsx,js,jsx) |
| `--cross-package` | only show dupes across packages/apps |
| `--json` | JSON output |

## How it works

dslop parses TypeScript/JavaScript with Babel and extracts functions, classes, types, and interfaces. It normalizes the AST by replacing all identifiers with generic placeholders (`$0`, `$1`, etc.), preserving only the code structure.

This catches:
- Functions with identical logic but different variable names
- Types/interfaces defined in multiple places
- Copy-pasted utilities across packages

Example: these two functions are detected as duplicates:

```ts
// apps/web/utils.ts
function getUserInitials(user: User): string {
  const first = user.firstName?.[0] ?? '';
  const last = user.lastName?.[0] ?? '';
  return (first + last).toUpperCase();
}

// apps/admin/helpers.ts  
function getInitials(person: Person): string {
  const f = person.firstName?.[0] ?? '';
  const l = person.lastName?.[0] ?? '';
  return (f + l).toUpperCase();
}
```

### What it ignores

- Same-file duplicates (patterns within a single file)
- Tiny functions (configurable via `--min-lines`)
- Common patterns from UI libraries (shadcn components, etc.)

## Performance

dslop uses aggressive caching to make subsequent runs fast:

```bash
# First run (builds cache)
$ dslop --all
Scanned 1410 files in 2862ms
Cache: 0 hits, 1410 misses (0% hit rate)

# Second run (uses cache)
$ dslop --all
Scanned 1410 files in 305ms
Cache: 1410 hits, 0 misses (100% hit rate)
```

Cache is stored in `.dslop-cache` in your project root. Add it to `.gitignore`.

Use `--no-cache` to bypass the cache.

## Limitations

- **TypeScript/JavaScript only:** AST parsing uses Babel with TS/JSX plugins
- **No cross-language:** Won't detect duplication across languages

## License

MIT
