import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ASTBlock } from "./ast";

const CACHE_VERSION = 2;
const CACHE_FILE = ".dslop-cache";

interface CachedFile {
  mtime: number;
  size: number;
  blocks: CachedBlock[];
}

interface CachedBlock {
  type: ASTBlock["type"];
  name: string;
  hash: string;
  normalized: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

interface CacheData {
  version: number;
  files: Record<string, CachedFile>;
}

export class ASTCache {
  private cache: CacheData = { version: CACHE_VERSION, files: {} };
  private cachePath: string;
  private dirty = false;
  private hits = 0;
  private misses = 0;

  constructor(targetPath: string) {
    this.cachePath = path.join(path.resolve(targetPath), CACHE_FILE);
  }

  async load(): Promise<void> {
    try {
      const data = await readFile(this.cachePath, "utf-8");
      const parsed = JSON.parse(data) as CacheData;
      
      // Invalidate cache if version mismatch
      if (parsed.version !== CACHE_VERSION) {
        this.cache = { version: CACHE_VERSION, files: {} };
        return;
      }
      
      this.cache = parsed;
    } catch {
      // No cache or invalid - start fresh
      this.cache = { version: CACHE_VERSION, files: {} };
    }
  }

  async get(filePath: string): Promise<ASTBlock[] | null> {
    const cached = this.cache.files[filePath];
    if (!cached) {
      this.misses++;
      return null;
    }

    try {
      const fileStat = await stat(filePath);
      
      // Check if file changed (mtime or size)
      if (fileStat.mtimeMs !== cached.mtime || fileStat.size !== cached.size) {
        this.misses++;
        return null;
      }

      this.hits++;
      
      // Reconstruct ASTBlock from cached data
      return cached.blocks.map(b => ({
        type: b.type,
        name: b.name,
        content: "", // Don't cache content - we can re-read if needed
        normalized: b.normalized,
        hash: b.hash,
        filePath,
        startLine: b.startLine,
        endLine: b.endLine,
        exported: b.exported,
      }));
    } catch {
      this.misses++;
      return null;
    }
  }

  async set(filePath: string, blocks: ASTBlock[]): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      
      this.cache.files[filePath] = {
        mtime: fileStat.mtimeMs,
        size: fileStat.size,
        blocks: blocks.map(b => ({
          type: b.type,
          name: b.name,
          hash: b.hash,
          normalized: b.normalized,
          startLine: b.startLine,
          endLine: b.endLine,
          exported: b.exported,
        })),
      };
      
      this.dirty = true;
    } catch {
      // Ignore stat errors
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    
    try {
      // Ensure directory exists
      const dir = path.dirname(this.cachePath);
      await mkdir(dir, { recursive: true });
      
      // Prune old entries (files that no longer exist or haven't been accessed)
      // Keep only files that were accessed in this run
      const prunedFiles: Record<string, CachedFile> = {};
      for (const [filePath, cached] of Object.entries(this.cache.files)) {
        try {
          await stat(filePath);
          prunedFiles[filePath] = cached;
        } catch {
          // File no longer exists, skip
        }
      }
      
      this.cache.files = prunedFiles;
      
      await writeFile(this.cachePath, JSON.stringify(this.cache), "utf-8");
    } catch {
      // Ignore write errors - cache is optional
    }
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}

