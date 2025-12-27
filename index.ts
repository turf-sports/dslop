#!/usr/bin/env bun

import { execSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { findASTDuplicates } from "./src/ast";
import { formatASTDuplicates } from "./src/formatter";
import { scanDirectory, type ScanOptions } from "./src/scanner";

const VERSION = process.env.npm_package_version || "__INJECT_VERSION__";

const DEFAULT_EXTENSIONS = ["ts", "tsx", "js", "jsx"];
const DEFAULT_IGNORE_PATTERNS = [
  "node_modules", "dist", ".git", "build", ".next", 
  "coverage", ".turbo", ".cache", "migrations", "__generated__",
];

type ChangedRange = { start: number; end: number };
type ChangedFiles = Map<string, ChangedRange[]>;

function parseDiffOutput(diff: string, cwd: string): ChangedFiles {
  const changes: ChangedFiles = new Map();
  let currentFile: string | null = null;
  let newLineNum = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = path.resolve(cwd, line.slice(6));
      if (!changes.has(currentFile)) {
        changes.set(currentFile, []);
      }
    } else if (line.startsWith("@@") && currentFile) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match?.[1]) {
        newLineNum = parseInt(match[1], 10);
      }
    } else if (currentFile && newLineNum > 0) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const ranges = changes.get(currentFile) ?? [];
        const lastRange = ranges[ranges.length - 1];
        if (lastRange && lastRange.end === newLineNum - 1) {
          lastRange.end = newLineNum;
        } else {
          ranges.push({ start: newLineNum, end: newLineNum });
        }
        newLineNum++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        // deleted line
      } else if (!line.startsWith("\\")) {
        newLineNum++;
      }
    }
  }
  return changes;
}

function getChangedLines(targetPath: string): ChangedFiles {
  const absolutePath = path.resolve(targetPath);
  const allChanges: ChangedFiles = new Map();

  const mergeChanges = (newChanges: ChangedFiles) => {
    for (const [file, ranges] of newChanges) {
      const existing = allChanges.get(file) ?? [];
      existing.push(...ranges);
      allChanges.set(file, existing);
    }
  };

  const addFullFile = (filePath: string) => {
    const resolved = path.resolve(absolutePath, filePath);
    if (!allChanges.has(resolved)) {
      allChanges.set(resolved, [{ start: 1, end: 999999 }]);
    }
  };

  try {
    mergeChanges(parseDiffOutput(execSync("git diff --cached", { cwd: absolutePath, encoding: "utf-8" }), absolutePath));
    mergeChanges(parseDiffOutput(execSync("git diff", { cwd: absolutePath, encoding: "utf-8" }), absolutePath));

    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: absolutePath, encoding: "utf-8" });
    for (const file of untracked.split("\n")) {
      if (file.trim()) addFullFile(file.trim());
    }

    try {
      const baseBranch = execSync("git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/main", { cwd: absolutePath, encoding: "utf-8" }).trim().replace("origin/", "");
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: absolutePath, encoding: "utf-8" }).trim();

      if (currentBranch !== baseBranch) {
        const mergeBase = execSync(`git merge-base ${baseBranch} HEAD 2>/dev/null || echo ""`, { cwd: absolutePath, encoding: "utf-8" }).trim();
        if (mergeBase) {
          mergeChanges(parseDiffOutput(execSync(`git diff ${mergeBase}...HEAD`, { cwd: absolutePath, encoding: "utf-8" }), absolutePath));
        }
      }
    } catch {}

    return allChanges;
  } catch {
    return new Map();
  }
}

function isInChangedLines(filePath: string, blockStart: number, blockEnd: number, changes: ChangedFiles): boolean {
  const ranges = changes.get(filePath);
  if (!ranges) return false;
  return ranges.some((r) => blockStart <= r.end && blockEnd >= r.start);
}

function showHelp() {
  console.log(`
dslop - Find duplicate functions and types

Usage:
  dslop [path] [options]

Options:
  -a, --all             Force full codebase scan
  -c, --changes         Force changes-only mode (exit if no changes found)
  -e, --extensions <s>  File extensions (default: ts,tsx,js,jsx)
  -i, --ignore <s>      Patterns to ignore
  --no-cache            Disable caching
  --cross-package       Only cross-package duplicates (monorepos)
  --json                JSON output
  -h, --help            Show help
  -v, --version         Show version

Examples:
  dslop                   Check PR changes (or full scan if none)
  dslop --all             Full codebase scan
  dslop --cross-package   Cross-package duplicates
`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      extensions: { type: "string", short: "e", default: DEFAULT_EXTENSIONS.join(",") },
      ignore: { type: "string", short: "i", default: DEFAULT_IGNORE_PATTERNS.join(",") },
      "no-cache": { type: "boolean", default: false },
      all: { type: "boolean", short: "a", default: false },
      changes: { type: "boolean", short: "c", default: false },
      "cross-package": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.version) {
    console.log(`dslop v${VERSION}`);
    process.exit(0);
  }

  const targetPath = positionals[0] || ".";
  const extensions = (values.extensions as string).split(",").map((e) => e.trim());
  const ignorePatterns = (values.ignore as string).split(",").map((p) => p.trim());
  const useCache = !values["no-cache"];
  const forceAll = values.all as boolean;
  const forceChanges = values.changes as boolean;
  const crossPackage = values["cross-package"] as boolean;
  const jsonOutput = values.json as boolean;

  const scanOptions: ScanOptions = { extensions, ignorePatterns };

  // Determine scan mode
  let scanAll = forceAll;
  let changedLines: ChangedFiles | null = null;

  if (!forceAll) {
    changedLines = getChangedLines(targetPath);
    
    if (changedLines.size === 0) {
      if (forceChanges) {
        console.log("\nNo changes found.");
        process.exit(0);
      }
      scanAll = true;
      if (!jsonOutput) {
        console.log(`\nNo changes detected, running full scan...`);
      }
    }
  }

  if (!jsonOutput) {
    console.log(`\nScanning ${targetPath}...`);
    console.log(`  Mode: ${scanAll ? "full scan" : `checking ${changedLines?.size} changed files`}`);
    if (crossPackage) console.log(`  Cross-package: enabled`);
    console.log();
  }

  try {
    const startTime = performance.now();
    const { astBlocks, fileCount, totalLines, cacheStats } = await scanDirectory(targetPath, scanOptions, useCache);
    const scanTime = performance.now() - startTime;

    if (!jsonOutput) {
      console.log(`Scanned ${fileCount} files (${totalLines.toLocaleString()} lines) in ${Math.round(scanTime)}ms`);
      if (cacheStats && (cacheStats.hits > 0 || cacheStats.misses > 0)) {
        console.log(`Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${Math.round(cacheStats.hitRate * 100)}% hit rate)`);
      }
      console.log(`Found ${astBlocks.length.toLocaleString()} functions/types\n`);
    }

    if (astBlocks.length === 0) {
      if (jsonOutput) {
        console.log(JSON.stringify({ summary: { duplicateGroups: 0 }, duplicates: [] }, null, 2));
      } else {
        console.log("No code found to analyze.");
      }
      process.exit(0);
    }

    const detectStart = performance.now();
    let duplicates = findASTDuplicates(astBlocks, 0.7);
    const detectTime = performance.now() - detectStart;

    // Filter to changed lines if not full scan
    if (!scanAll && changedLines) {
      duplicates = duplicates.filter((group) => {
        const inChanged = group.matches.filter((m) => 
          isInChangedLines(m.filePath, m.startLine, m.endLine, changedLines)
        );
        const notInChanged = group.matches.filter((m) => 
          !isInChangedLines(m.filePath, m.startLine, m.endLine, changedLines)
        );
        return inChanged.length > 0 && notInChanged.length > 0;
      });
    }

    // Filter to cross-package only
    if (crossPackage) {
      duplicates = duplicates.filter((group) => {
        const packages = new Set(
          group.matches.map((m) => {
            const match = m.filePath.match(/(?:apps|packages|libs)\/([^/]+)/);
            return match ? match[1] : m.filePath.split("/")[0];
          })
        );
        return packages.size > 1;
      });
    }

    if (!jsonOutput) {
      console.log(`Found ${duplicates.length} duplicate groups in ${Math.round(detectTime)}ms\n`);
    }

    if (duplicates.length === 0) {
      if (jsonOutput) {
        console.log(JSON.stringify({ summary: { duplicateGroups: 0 }, duplicates: [] }, null, 2));
      } else {
        console.log(crossPackage ? "No cross-package duplicates found!" : "No duplicates found!");
      }
      process.exit(0);
    }

    if (jsonOutput) {
      const compactAST = duplicates.slice(0, 50).map(a => ({
        type: a.type,
        name: a.matches[0]?.name || 'unknown',
        occurrences: a.matches.length,
        locations: a.matches.map(m => ({
          name: m.name,
          file: m.filePath.replace(process.cwd() + '/', ''),
          line: m.startLine,
          exported: m.exported,
        })),
      }));
      console.log(JSON.stringify({
        summary: { duplicateGroups: duplicates.length },
        duplicates: compactAST,
      }, null, 2));
    } else {
      console.log(formatASTDuplicates(duplicates, targetPath));
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
