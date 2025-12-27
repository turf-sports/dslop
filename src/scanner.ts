import { glob } from "glob";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { normalizeCode } from "./normalizer";
import {
  MAX_BLOCK_SIZE,
  BLOCK_SIZE_MULTIPLIER,
  MIN_MEANINGFUL_LINE_RATIO,
  SLIDING_WINDOW_STEP_DIVISOR,
  SKIP_LINE_PREFIXES,
  MAX_FILE_SIZE,
} from "./constants";

export interface CodeBlock {
  content: string; // Original content
  normalized: string; // Normalized for comparison
  hash: string; // Hash of normalized content
  filePath: string; // Absolute file path
  startLine: number;
  endLine: number;
  lineCount: number;
}

export interface ScanOptions {
  extensions: string[];
  ignorePatterns: string[];
  minLines: number;
  normalize: boolean;
}

export interface ScanResult {
  blocks: CodeBlock[];
  fileCount: number;
  totalLines: number;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;

  return SKIP_LINE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function extractBlocks(
  content: string,
  filePath: string,
  minLines: number,
  shouldNormalize: boolean
): CodeBlock[] {
  const lines = content.split("\n");
  const blocks: CodeBlock[] = [];

  if (lines.length < minLines) {
    return blocks;
  }

  const blockSizes = [minLines];
  const maxSize = Math.min(MAX_BLOCK_SIZE, lines.length);
  for (
    let size = Math.floor(minLines * BLOCK_SIZE_MULTIPLIER);
    size <= maxSize;
    size = Math.floor(size * BLOCK_SIZE_MULTIPLIER)
  ) {
    blockSizes.push(size);
  }

  for (const blockSize of blockSizes) {
    const step = Math.max(
      1,
      Math.floor(blockSize / SLIDING_WINDOW_STEP_DIVISOR)
    );

    for (let i = 0; i <= lines.length - blockSize; i += step) {
      const blockLines = lines.slice(i, i + blockSize);
      const blockContent = blockLines.join("\n");

      const meaningfulLines = blockLines.filter(
        (line) => !isSkippableLine(line)
      );

      if (meaningfulLines.length < blockSize * MIN_MEANINGFUL_LINE_RATIO) {
        continue;
      }

      const normalized = shouldNormalize
        ? normalizeCode(blockContent)
        : blockContent;
      const hash = simpleHash(normalized);

      blocks.push({
        content: blockContent,
        normalized,
        hash,
        filePath,
        startLine: i + 1, // 1-indexed
        endLine: i + blockSize,
        lineCount: blockSize,
      });
    }
  }

  return blocks;
}

function shouldIgnore(filePath: string, ignorePatterns: string[]): boolean {
  const normalizedPath = filePath.toLowerCase();
  return ignorePatterns.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase();
    return (
      normalizedPath.includes(`/${normalizedPattern}/`) ||
      normalizedPath.includes(`\\${normalizedPattern}\\`) ||
      normalizedPath.endsWith(`/${normalizedPattern}`) ||
      normalizedPath.endsWith(`\\${normalizedPattern}`)
    );
  });
}

export async function scanDirectory(
  targetPath: string,
  options: ScanOptions
): Promise<ScanResult> {
  const { extensions, ignorePatterns, minLines, normalize } = options;

  const absolutePath = path.resolve(targetPath);
  const blocks: CodeBlock[] = [];
  let fileCount = 0;
  let totalLines = 0;

  const pattern = extensions.length === 1 
    ? `**/*.${extensions[0]}` 
    : `**/*.{${extensions.join(",")}}`;

  const files = await glob(pattern, {
    cwd: absolutePath,
    absolute: true,
    nodir: true,
    ignore: ignorePatterns.map(p => `**/${p}/**`),
  });

  for (const filePath of files) {
    if (shouldIgnore(filePath, ignorePatterns)) {
      continue;
    }

    try {
      const fileStat = await stat(filePath);

      if (fileStat.size > MAX_FILE_SIZE) {
        continue;
      }

      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").length;

      totalLines += lines;
      fileCount++;

      const fileBlocks = extractBlocks(
        content,
        filePath,
        minLines,
        normalize
      );
      blocks.push(...fileBlocks);
    } catch {
      // Skip files we can't read
      console.warn(`Warning: Could not read ${filePath}`);
    }
  }

  return { blocks, fileCount, totalLines };
}
