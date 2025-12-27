import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ASTBlock } from "./ast";

const CACHE_VERSION = 3;
const CACHE_FILE = ".dslop-cache";

interface CachedFile {
  mtime: number;
  size: number;
  lineCount: number;
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

export interface CacheResult {
  blocks: ASTBlock[];
  lineCount: number;
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
      
      if (parsed.version !== CACHE_VERSION) {
        this.cache = { version: CACHE_VERSION, files: {} };
        return;
      }
      
      this.cache = parsed;
    } catch {
      this.cache = { version: CACHE_VERSION, files: {} };
    }
  }

  // Check cache with pre-fetched stat
  get(filePath: string, mtime: number, size: number): CacheResult | null {
    const cached = this.cache.files[filePath];
    if (!cached) {
      this.misses++;
      return null;
    }

    if (mtime !== cached.mtime || size !== cached.size) {
      this.misses++;
      return null;
    }

    this.hits++;
    
    return {
      lineCount: cached.lineCount,
      blocks: cached.blocks.map(b => ({
        type: b.type,
        name: b.name,
        content: "",
        normalized: b.normalized,
        hash: b.hash,
        filePath,
        startLine: b.startLine,
        endLine: b.endLine,
        exported: b.exported,
      })),
    };
  }

  set(filePath: string, blocks: ASTBlock[], lineCount: number, mtime: number, size: number): void {
    this.cache.files[filePath] = {
      mtime,
      size,
      lineCount,
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
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    
    try {
      const dir = path.dirname(this.cachePath);
      await mkdir(dir, { recursive: true });
      await writeFile(this.cachePath, JSON.stringify(this.cache), "utf-8");
    } catch {
      // Ignore write errors
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
