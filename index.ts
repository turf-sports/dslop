#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_MIN_LINES,
  DEFAULT_SIMILARITY,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_PATTERNS,
} from "./src/constants";
import { findDuplicates, findDeclarationDuplicates } from "./src/detector";
import { formatOutput, formatStats, formatDeclarations } from "./src/formatter";
import { scanDirectory, type ScanOptions } from "./src/scanner";

const VERSION = process.env.npm_package_version || "__INJECT_VERSION__";

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
      if (match) {
        newLineNum = parseInt(match[1], 10);
      }
    } else if (currentFile && newLineNum > 0) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        const ranges = changes.get(currentFile)!;
        const lastRange = ranges[ranges.length - 1];
        if (lastRange && lastRange.end === newLineNum - 1) {
          lastRange.end = newLineNum;
        } else {
          ranges.push({ start: newLineNum, end: newLineNum });
        }
        newLineNum++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        // deleted line, don't increment newLineNum
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
      if (!allChanges.has(file)) {
        allChanges.set(file, []);
      }
      allChanges.get(file)!.push(...ranges);
    }
  };

  const addFullFile = (filePath: string) => {
    const resolved = path.resolve(absolutePath, filePath);
    if (!allChanges.has(resolved)) {
      allChanges.set(resolved, [{ start: 1, end: 999999 }]);
    }
  };

  try {
    const stagedDiff = execSync("git diff --cached", { cwd: absolutePath, encoding: "utf-8" });
    mergeChanges(parseDiffOutput(stagedDiff, absolutePath));

    const unstagedDiff = execSync("git diff", { cwd: absolutePath, encoding: "utf-8" });
    mergeChanges(parseDiffOutput(unstagedDiff, absolutePath));

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
          const branchDiff = execSync(`git diff ${mergeBase}...HEAD`, { cwd: absolutePath, encoding: "utf-8" });
          mergeChanges(parseDiffOutput(branchDiff, absolutePath));
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
dslop - Detect Similar/Duplicate Lines Of Programming

Usage:
  dslop [path] [options]

By default, checks your branch changes (committed + uncommitted) against the codebase.

Arguments:
  path                  Directory to scan (default: current directory)

Options:
  -a, --all             Scan entire codebase (not just uncommitted changes)
  -m, --min-lines <n>   Minimum block size in lines (default: ${DEFAULT_MIN_LINES})
  -s, --similarity <n>  Minimum similarity threshold 0-100 (default: ${Math.round(DEFAULT_SIMILARITY * 100)})
  -e, --extensions <s>  File extensions to scan (default: ${DEFAULT_EXTENSIONS.join(",")})
  -i, --ignore <s>      Patterns to ignore (default: ${DEFAULT_IGNORE_PATTERNS.slice(0, 4).join(",")},...)
  --no-normalize        Disable string/number normalization
  --cross-package       Only show duplicates across different packages/apps (monorepo mode)
  --json                Output as JSON
  -h, --help            Show this help message
  -v, --version         Show version

Examples:
  dslop                            Check your PR/branch changes for duplicates
  dslop --all                      Scan entire codebase
  dslop ./src -m 6 -s 80           Scan src with 6 line min, 80% similarity
  dslop --all --cross-package      Cross-package duplicates in entire codebase
`);
}

function showVersion() {
  console.log(`dslop v${VERSION}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "min-lines": { type: "string", short: "m", default: String(DEFAULT_MIN_LINES) },
      similarity: { type: "string", short: "s", default: String(Math.round(DEFAULT_SIMILARITY * 100)) },
      extensions: { type: "string", short: "e", default: DEFAULT_EXTENSIONS.join(",") },
      ignore: { type: "string", short: "i", default: DEFAULT_IGNORE_PATTERNS.join(",") },
      normalize: { type: "boolean", default: true },
      "no-normalize": { type: "boolean", default: false },
      all: { type: "boolean", short: "a", default: false },
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
    showVersion();
    process.exit(0);
  }

  const targetPath = positionals[0] || ".";
  const minLines = parseInt(values["min-lines"] as string, 10);
  const similarity = parseInt(values.similarity as string, 10) / 100;
  const extensions = (values.extensions as string).split(",").map((e) => e.trim());
  const ignorePatterns = (values.ignore as string).split(",").map((p) => p.trim());
  const normalize = !values["no-normalize"];
  const scanAll = values.all as boolean;
  const crossPackage = values["cross-package"] as boolean;
  const jsonOutput = values.json as boolean;

  if (minLines < 2) {
    console.error("Error: --min-lines must be at least 2");
    process.exit(1);
  }
  if (similarity < 0 || similarity > 1) {
    console.error("Error: --similarity must be between 0 and 100");
    process.exit(1);
  }

  const scanOptions: ScanOptions = {
    extensions,
    ignorePatterns,
    minLines,
    normalize,
  };

  const changedLines = !scanAll ? getChangedLines(targetPath) : null;
  
  if (!scanAll && changedLines?.size === 0) {
    console.log("\nNo changes found. Use --all to scan entire codebase.");
    process.exit(0);
  }

  console.log(`\nScanning ${targetPath}...`);
  if (!scanAll) {
    console.log(`  Mode: checking changed lines in ${changedLines!.size} files`);
  } else {
    console.log(`  Mode: full codebase scan`);
  }
  console.log(`  Extensions: ${extensions.join(", ")}`);
  console.log(`  Min block size: ${minLines} lines`);
  console.log(`  Similarity threshold: ${Math.round(similarity * 100)}%`);
  if (crossPackage) {
    console.log(`  Cross-package: enabled`);
  }
  console.log();

  try {
    const startTime = performance.now();
    // Only extract declarations in --all mode (faster default mode)
    const { blocks, declarations, fileCount, totalLines } = await scanDirectory(targetPath, scanOptions, scanAll);
    const scanTime = performance.now() - startTime;

    console.log(`Scanned ${fileCount} files (${totalLines.toLocaleString()} lines) in ${Math.round(scanTime)}ms`);
    if (declarations.length > 0) {
      console.log(`Extracted ${blocks.length.toLocaleString()} code blocks, ${declarations.length.toLocaleString()} declarations\n`);
    } else {
      console.log(`Extracted ${blocks.length.toLocaleString()} code blocks\n`);
    }

    if (blocks.length === 0 && declarations.length === 0) {
      console.log("No code found to analyze.");
      process.exit(0);
    }

    const detectStart = performance.now();
    let duplicates = findDuplicates(blocks, similarity, targetPath);
    let declDuplicates = findDeclarationDuplicates(declarations, similarity);
    const detectTime = performance.now() - detectStart;

    if (!scanAll && changedLines) {
      const changedFilePaths = new Set(changedLines.keys());
      
      duplicates = duplicates.filter((group) => {
        const inChanged = group.matches.filter((m) => 
          isInChangedLines(m.filePath, m.startLine, m.endLine, changedLines)
        );
        const notInChanged = group.matches.filter((m) => 
          !isInChangedLines(m.filePath, m.startLine, m.endLine, changedLines)
        );
        if (inChanged.length === 0 || notInChanged.length === 0) return false;
        
        const inOtherFiles = notInChanged.some((m) => !changedFilePaths.has(m.filePath));
        const inSameFileOutsideChanges = notInChanged.some((m) => changedFilePaths.has(m.filePath));
        
        if (inOtherFiles && group.matches.length > 10) return false;
        
        return inOtherFiles || inSameFileOutsideChanges;
      });

      declDuplicates = declDuplicates.filter((group) => {
        const inChanged = group.matches.filter((m) => 
          isInChangedLines(m.filePath, m.startLine, m.endLine, changedLines)
        );
        const notInChanged = group.matches.filter((m) => 
          !isInChangedLines(m.filePath, m.startLine, m.endLine, changedLines)
        );
        return inChanged.length > 0 && notInChanged.length > 0;
      });
    }

    if (crossPackage) {
      duplicates = duplicates.filter((group) => {
        const packages = new Set(
          group.matches.map((m) => {
            const match = m.filePath.match(/(?:apps|packages|libs)\/([^\/]+)/);
            return match ? match[1] : m.filePath.split("/")[0];
          })
        );
        return packages.size > 1;
      });
      
      declDuplicates = declDuplicates.filter((group) => {
        const packages = new Set(
          group.matches.map((m) => {
            const match = m.filePath.match(/(?:apps|packages|libs)\/([^\/]+)/);
            return match ? match[1] : m.filePath.split("/")[0];
          })
        );
        return packages.size > 1;
      });
    }

    const totalGroups = duplicates.length + declDuplicates.length;
    console.log(`Found ${totalGroups} duplicate groups in ${Math.round(detectTime)}ms`);
    if (declDuplicates.length > 0) {
      console.log(`  (${duplicates.length} code blocks, ${declDuplicates.length} declarations)\n`);
    } else {
      console.log();
    }

    if (totalGroups === 0) {
      if (!scanAll) {
        console.log("No duplicates in your changes. You're good!");
      } else if (crossPackage) {
        console.log("No cross-package duplicates found!");
      } else {
        console.log("No duplicates found!");
      }
      process.exit(0);
    }

    if (jsonOutput) {
      console.log(JSON.stringify({ duplicates, declarations: declDuplicates }, null, 2));
    } else {
      if (duplicates.length > 0) {
        console.log(formatOutput(duplicates, targetPath));
        console.log(formatStats(duplicates));
      }
      if (declDuplicates.length > 0) {
        console.log(formatDeclarations(declDuplicates, targetPath));
      }
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
