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
import { findDuplicates } from "./src/detector";
import { formatOutput, formatStats } from "./src/formatter";
import { scanDirectory, type ScanOptions } from "./src/scanner";

const VERSION = process.env.npm_package_version || "__INJECT_VERSION__";

function getChangedFiles(targetPath: string): Set<string> {
  const absolutePath = path.resolve(targetPath);
  try {
    const staged = execSync("git diff --cached --name-only", { cwd: absolutePath, encoding: "utf-8" });
    const unstaged = execSync("git diff --name-only", { cwd: absolutePath, encoding: "utf-8" });
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: absolutePath, encoding: "utf-8" });
    
    const files = new Set<string>();
    for (const file of [...staged.split("\n"), ...unstaged.split("\n"), ...untracked.split("\n")]) {
      if (file.trim()) {
        files.add(path.resolve(absolutePath, file.trim()));
      }
    }
    return files;
  } catch {
    return new Set();
  }
}

function showHelp() {
  console.log(`
dslop - Detect Similar/Duplicate Lines Of Programming

Usage:
  dslop [path] [options]

Arguments:
  path                  Directory to scan (default: current directory)

Options:
  -m, --min-lines <n>   Minimum block size in lines (default: ${DEFAULT_MIN_LINES})
  -s, --similarity <n>  Minimum similarity threshold 0-100 (default: ${Math.round(DEFAULT_SIMILARITY * 100)})
  -e, --extensions <s>  File extensions to scan (default: ${DEFAULT_EXTENSIONS.join(",")})
  -i, --ignore <s>      Patterns to ignore (default: ${DEFAULT_IGNORE_PATTERNS.slice(0, 4).join(",")},...)
  --staged              Only show duplicates involving uncommitted changes
  --no-normalize        Disable string/number normalization
  --cross-package       Only show duplicates across different packages/apps (monorepo mode)
  --json                Output as JSON
  -h, --help            Show this help message
  -v, --version         Show version

Examples:
  dslop .                          Scan current directory
  dslop --staged                   Check uncommitted changes for duplicates
  dslop ./src -m 6 -s 80           Scan src with 6 line min, 80% similarity
  dslop . --cross-package          Only duplicates across packages (great for monorepos)
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
      staged: { type: "boolean", default: false },
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
  const staged = values.staged as boolean;
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

  const changedFiles = staged ? getChangedFiles(targetPath) : null;
  
  if (staged && changedFiles?.size === 0) {
    console.log("\nNo uncommitted changes found.");
    process.exit(0);
  }

  console.log(`\nScanning ${targetPath}...`);
  console.log(`  Extensions: ${extensions.join(", ")}`);
  console.log(`  Min block size: ${minLines} lines`);
  console.log(`  Similarity threshold: ${Math.round(similarity * 100)}%`);
  console.log(`  Normalization: ${normalize ? "enabled" : "disabled"}`);
  if (staged) {
    console.log(`  Staged mode: checking ${changedFiles!.size} changed files against codebase`);
  }
  if (crossPackage) {
    console.log(`  Cross-package mode: enabled`);
  }
  console.log();

  try {
    const startTime = performance.now();
    const { blocks, fileCount, totalLines } = await scanDirectory(targetPath, scanOptions);
    const scanTime = performance.now() - startTime;

    console.log(`Scanned ${fileCount} files (${totalLines.toLocaleString()} lines) in ${Math.round(scanTime)}ms`);
    console.log(`Extracted ${blocks.length.toLocaleString()} code blocks\n`);

    if (blocks.length === 0) {
      console.log("No code blocks found to analyze.");
      process.exit(0);
    }

    const detectStart = performance.now();
    let duplicates = findDuplicates(blocks, similarity, targetPath);
    const detectTime = performance.now() - detectStart;

    if (staged && changedFiles) {
      duplicates = duplicates.filter((group) => 
        group.matches.some((m) => changedFiles.has(m.filePath))
      );
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
    }

    console.log(`Found ${duplicates.length} duplicate groups in ${Math.round(detectTime)}ms\n`);

    if (duplicates.length === 0) {
      if (staged) {
        console.log("No duplicates in your changes. You're good!");
      } else if (crossPackage) {
        console.log("No cross-package duplicates found!");
      } else {
        console.log("No duplicates found!");
      }
      process.exit(0);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(duplicates, null, 2));
    } else {
      console.log(formatOutput(duplicates, targetPath));
      console.log(formatStats(duplicates));
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
