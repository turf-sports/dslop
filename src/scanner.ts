import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { extractASTBlocks, type ASTBlock } from "./ast";
import { ASTCache } from "./cache";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const PARALLEL_BATCH_SIZE = 50; // Process files in parallel batches

export type { ASTBlock };

export interface ScanOptions {
  extensions: string[];
  ignorePatterns: string[];
}

export interface ScanResult {
  astBlocks: ASTBlock[];
  fileCount: number;
  totalLines: number;
  cacheStats?: { hits: number; misses: number; hitRate: number };
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

interface FileResult {
  blocks: ASTBlock[];
  lineCount: number;
}

async function processFile(
  filePath: string,
  cache: ASTCache | null
): Promise<FileResult | null> {
  try {
    const fileStat = await stat(filePath);
    
    if (fileStat.size > MAX_FILE_SIZE) {
      return null;
    }

    // Try cache first (synchronous check with pre-fetched stat)
    const cached = cache?.get(filePath, fileStat.mtimeMs, fileStat.size);
    if (cached) {
      return cached;
    }

    // Cache miss - read and parse file
    const content = await readFile(filePath, "utf-8");
    const lineCount = content.split("\n").length;
    const blocks = extractASTBlocks(content, filePath);
    
    // Update cache
    cache?.set(filePath, blocks, lineCount, fileStat.mtimeMs, fileStat.size);
    
    return { blocks, lineCount };
  } catch {
    return null;
  }
}

export async function scanDirectory(
  targetPath: string,
  options: ScanOptions,
  useCache = true
): Promise<ScanResult> {
  const { extensions, ignorePatterns } = options;

  const absolutePath = path.resolve(targetPath);
  const astBlocks: ASTBlock[] = [];
  let fileCount = 0;
  let totalLines = 0;

  // Initialize cache
  const cache = useCache ? new ASTCache(targetPath) : null;
  if (cache) {
    await cache.load();
  }

  const pattern = extensions.length === 1 
    ? `**/*.${extensions[0]}` 
    : `**/*.{${extensions.join(",")}}`;

  const allFiles = await glob(pattern, {
    cwd: absolutePath,
    absolute: true,
    nodir: true,
    ignore: ignorePatterns.map(p => `**/${p}/**`),
  });

  // Filter to valid files
  const files = allFiles.filter(filePath => {
    if (shouldIgnore(filePath, ignorePatterns)) return false;
    const ext = path.extname(filePath);
    return ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx";
  });

  // Process files in parallel batches
  for (let i = 0; i < files.length; i += PARALLEL_BATCH_SIZE) {
    const batch = files.slice(i, i + PARALLEL_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(filePath => processFile(filePath, cache))
    );
    
    for (const result of results) {
      if (result) {
        astBlocks.push(...result.blocks);
        totalLines += result.lineCount;
        fileCount++;
      }
    }
  }

  // Save cache
  if (cache) {
    await cache.save();
  }

  return { 
    astBlocks, 
    fileCount, 
    totalLines,
    cacheStats: cache?.getStats(),
  };
}
