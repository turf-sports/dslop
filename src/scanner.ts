import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { extractASTBlocks, type ASTBlock } from "./ast";
import { ASTCache } from "./cache";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

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

    // Only process TypeScript/JavaScript files for AST
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && 
        !filePath.endsWith(".js") && !filePath.endsWith(".jsx")) {
      continue;
    }

    try {
      const fileStat = await stat(filePath);

      if (fileStat.size > MAX_FILE_SIZE) {
        continue;
      }

      // Try cache first
      const cachedAST = cache ? await cache.get(filePath) : null;

      if (cachedAST) {
        // Cache hit
        astBlocks.push(...cachedAST);
        
        // Still need to count lines
        const content = await readFile(filePath, "utf-8");
        totalLines += content.split("\n").length;
        fileCount++;
      } else {
        // Cache miss - parse file
        const content = await readFile(filePath, "utf-8");
        totalLines += content.split("\n").length;
        fileCount++;

        const fileAST = extractASTBlocks(content, filePath);
        astBlocks.push(...fileAST);
        
        // Cache the result
        if (cache) {
          await cache.set(filePath, fileAST);
        }
      }
    } catch {
      // Skip files that can't be read
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
