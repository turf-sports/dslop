import type { CodeBlock, Declaration, DeclarationType } from "./scanner";
import { calculateNameSimilarity } from "./declarations";
import {
  SIZE_BUCKET_DIVISOR,
  MAX_SIMILARITY_SAMPLES,
  MIN_OCCURRENCES,
  GROUP_OVERLAP_THRESHOLD,
  MAX_BLOCKS_FOR_SIMILARITY,
} from "./constants";

export interface DuplicateMatch {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  declarationType?: DeclarationType;
  declarationName?: string;
}

export interface DeclarationDuplicate {
  id: number;
  type: DeclarationType;
  similarity: number;
  nameSimilarity: number;
  contentSimilarity: number;
  matches: Array<{
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    exported: boolean;
  }>;
  suggestion: string;
}

export interface RefactoringSuggestion {
  targetLocation: string;        // Suggested file/package location
  reason: string;                // Why this location was chosen
  confidence: "high" | "medium" | "low";
  suggestedName?: string;        // Suggested name for extracted code
}

export interface DuplicateGroup {
  id: number;
  similarity: number;
  lineCount: number;
  occurrences: number;
  matches: DuplicateMatch[];
  pattern: string; // Representative normalized pattern
  suggestion?: RefactoringSuggestion; // Where to refactor this code
}

/**
 * Fast similarity check using line-by-line comparison
 * Much faster than Levenshtein for code blocks
 */
function calculateSimilarityFast(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const linesA = a.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const linesB = b.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  if (linesA.length === 0 || linesB.length === 0) return 0;
  
  // Quick length check - if lengths differ significantly, likely not similar
  const lenRatio = Math.min(linesA.length, linesB.length) / Math.max(linesA.length, linesB.length);
  if (lenRatio < 0.5) return lenRatio * 0.5;

  // Count matching lines (intersection)
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  
  let intersection = 0;
  for (const line of setA) {
    if (setB.has(line)) {
      intersection++;
    }
  }

  // Jaccard similarity: intersection / union
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Get a structural fingerprint for fast pre-filtering
 */
function getFingerprint(normalized: string): string {
  // Take first, middle, and last portions
  const lines = normalized.split('\n');
  if (lines.length < 3) return normalized.slice(0, 100);
  
  const first = lines.slice(0, 2).join('');
  const mid = lines[Math.floor(lines.length / 2)] ?? '';
  const last = lines.slice(-2).join('');
  
  return (first + mid + last).slice(0, 200);
}

/**
 * Group similar blocks together using Union-Find
 */
class UnionFind {
  private parent: Map<number, number> = new Map();
  private rank: Map<number, number> = new Map();

  find(x: number): number {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    
    const parentVal = this.parent.get(x);
    if (parentVal !== undefined && parentVal !== x) {
      const root = this.find(parentVal);
      this.parent.set(x, root);
      return root;
    }
    return this.parent.get(x) ?? x;
  }

  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX) ?? 0;
    const rankY = this.rank.get(rootY) ?? 0;

    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }
}

/**
 * Find duplicate code blocks
 */
export function findDuplicates(
  blocks: CodeBlock[],
  minSimilarity: number,
  basePath: string
): DuplicateGroup[] {
  // Group blocks by hash first for exact matches (fast)
  const hashGroups = new Map<string, CodeBlock[]>();
  
  for (const block of blocks) {
    const existing = hashGroups.get(block.hash) ?? [];
    existing.push(block);
    hashGroups.set(block.hash, existing);
  }

  // Find exact duplicates (same hash)
  const exactDuplicates: DuplicateGroup[] = [];
  let groupId = 0;

  for (const [, groupBlocks] of hashGroups) {
    // Filter to only cross-file duplicates or same-file blocks that don't overlap
    const uniqueLocations = filterOverlappingBlocks(groupBlocks);
    
    if (uniqueLocations.length >= MIN_OCCURRENCES) {
      exactDuplicates.push({
        id: groupId++,
        similarity: 1.0,
        lineCount: uniqueLocations[0]?.lineCount ?? 0,
        occurrences: uniqueLocations.length,
        matches: uniqueLocations.map((b) => ({
          filePath: b.filePath,
          startLine: b.startLine,
          endLine: b.endLine,
          content: b.content,
        })),
        pattern: uniqueLocations[0]?.normalized ?? '',
      });
    }
  }

  // For similar (not exact) matches, we need to compare blocks
  const similarDuplicates: DuplicateGroup[] = [];
  
  // Only look for similar matches if similarity threshold is below 100%
  // and we have a reasonable number of unique hashes
  const uniqueHashCount = hashGroups.size;
  
  if (minSimilarity < 1.0 && uniqueHashCount <= MAX_BLOCKS_FOR_SIMILARITY) {
    // Get unique blocks (one per hash) for similarity comparison
    const uniqueBlocks: CodeBlock[] = [];
    const seenHashes = new Set<string>();
    
    for (const block of blocks) {
      if (!seenHashes.has(block.hash)) {
        seenHashes.add(block.hash);
        uniqueBlocks.push(block);
      }
    }

    // Group by line count range for more efficient comparison
    const sizeGroups = new Map<number, CodeBlock[]>();
    for (const block of uniqueBlocks) {
      const sizeKey = Math.floor(block.lineCount / SIZE_BUCKET_DIVISOR);
      const existing = sizeGroups.get(sizeKey) ?? [];
      existing.push(block);
      sizeGroups.set(sizeKey, existing);
    }

    // Pre-compute fingerprints for fast filtering
    const fingerprints = new Map<CodeBlock, string>();
    for (const block of uniqueBlocks) {
      fingerprints.set(block, getFingerprint(block.normalized));
    }

    const uf = new UnionFind();
    const blockIndexMap = new Map<CodeBlock, number>();
    for (let i = 0; i < uniqueBlocks.length; i++) {
      const block = uniqueBlocks[i];
      if (block) blockIndexMap.set(block, i);
    }

    // Compare blocks within similar size groups
    for (const [sizeKey, sizeGroup] of sizeGroups) {
      // Only compare with same and adjacent size groups
      const adjacentGroups = [
        sizeGroups.get(sizeKey - 1) ?? [],
        sizeGroup,
        sizeGroups.get(sizeKey + 1) ?? [],
      ].flat();

      // Limit comparisons per group
      const maxComparisons = 1000;
      let comparisons = 0;

      for (let i = 0; i < sizeGroup.length && comparisons < maxComparisons; i++) {
        const blockA = sizeGroup[i];
        if (!blockA) continue;
        
        const fpA = fingerprints.get(blockA) ?? '';

        for (let j = 0; j < adjacentGroups.length && comparisons < maxComparisons; j++) {
          const blockB = adjacentGroups[j];
          if (!blockB) continue;
          
          if (blockA === blockB) continue;
          if (blockA.hash === blockB.hash) continue;

          // Fast fingerprint pre-check
          const fpB = fingerprints.get(blockB) ?? '';
          const fpSimilarity = calculateSimilarityFast(fpA, fpB);
          if (fpSimilarity < minSimilarity * 0.5) continue;

          comparisons++;
          
          // Full similarity check
          const similarity = calculateSimilarityFast(blockA.normalized, blockB.normalized);
          
          if (similarity >= minSimilarity) {
            const idxA = blockIndexMap.get(blockA);
            const idxB = blockIndexMap.get(blockB);
            if (idxA !== undefined && idxB !== undefined) {
              uf.union(idxA, idxB);
            }
          }
        }
      }
    }

    // Collect groups from union-find
    const groupMap = new Map<number, CodeBlock[]>();
    for (const block of uniqueBlocks) {
      const idx = blockIndexMap.get(block);
      if (idx === undefined) continue;
      
      const root = uf.find(idx);
      const existing = groupMap.get(root) ?? [];
      existing.push(block);
      groupMap.set(root, existing);
    }

    // Convert to DuplicateGroup
    for (const [, groupBlocks] of groupMap) {
      if (groupBlocks.length < MIN_OCCURRENCES) continue;

      // Expand back to all blocks with matching hashes
      const expandedBlocks: CodeBlock[] = [];
      for (const block of groupBlocks) {
        const matching = hashGroups.get(block.hash) ?? [];
        expandedBlocks.push(...matching);
      }

      const uniqueLocations = filterOverlappingBlocks(expandedBlocks);
      
      if (uniqueLocations.length >= MIN_OCCURRENCES) {
        // Calculate average similarity within group (sample for performance)
        let totalSim = 0;
        let comparisons = 0;
        const sampleSize = Math.min(groupBlocks.length, MAX_SIMILARITY_SAMPLES);
        for (let i = 0; i < sampleSize; i++) {
          for (let j = i + 1; j < sampleSize; j++) {
            const blockI = groupBlocks[i];
            const blockJ = groupBlocks[j];
            if (blockI && blockJ) {
              totalSim += calculateSimilarityFast(blockI.normalized, blockJ.normalized);
              comparisons++;
            }
          }
        }
        const avgSimilarity = comparisons > 0 ? totalSim / comparisons : 1;

        similarDuplicates.push({
          id: groupId++,
          similarity: avgSimilarity,
          lineCount: Math.round(
            uniqueLocations.reduce((sum, b) => sum + b.lineCount, 0) / uniqueLocations.length
          ),
          occurrences: uniqueLocations.length,
          matches: uniqueLocations.map((b) => ({
            filePath: b.filePath,
            startLine: b.startLine,
            endLine: b.endLine,
            content: b.content,
          })),
          pattern: groupBlocks[0]?.normalized ?? '',
        });
      }
    }
  }

  // Filter groups that don't meet the similarity threshold
  const filteredSimilar = similarDuplicates.filter(g => g.similarity >= minSimilarity);
  
  // Combine and sort by occurrences (most duplicated first), then by lines as tiebreaker
  const allDuplicates = [...exactDuplicates, ...filteredSimilar];
  allDuplicates.sort((a, b) => {
    if (b.occurrences !== a.occurrences) {
      return b.occurrences - a.occurrences;
    }
    return b.lineCount - a.lineCount;
  });

  // Deduplicate groups that have significant overlap
  const dedupedGroups = deduplicateGroups(allDuplicates);
  
  // Filter out same-file duplicates (only keep cross-file duplicates)
  const crossFileGroups = dedupedGroups.filter(group => {
    const uniqueFiles = new Set(group.matches.map(m => m.filePath));
    return uniqueFiles.size > 1;
  });
  
  // Add refactoring suggestions to each group
  return crossFileGroups.map(group => ({
    ...group,
    suggestion: generateRefactoringSuggestion(group, basePath),
  }));
}

/**
 * Filter out blocks that overlap within the same file
 */
function filterOverlappingBlocks(blocks: CodeBlock[]): CodeBlock[] {
  const byFile = new Map<string, CodeBlock[]>();
  for (const block of blocks) {
    const existing = byFile.get(block.filePath) ?? [];
    existing.push(block);
    byFile.set(block.filePath, existing);
  }

  const result: CodeBlock[] = [];

  for (const [, fileBlocks] of byFile) {
    fileBlocks.sort((a, b) => a.startLine - b.startLine);

    const kept: CodeBlock[] = [];
    for (const block of fileBlocks) {
      const overlaps = kept.some((k) => 
        (block.startLine >= k.startLine && block.startLine <= k.endLine) ||
        (block.endLine >= k.startLine && block.endLine <= k.endLine) ||
        (block.startLine <= k.startLine && block.endLine >= k.endLine)
      );

      if (!overlaps) {
        kept.push(block);
      }
    }

    result.push(...kept);
  }

  return result;
}

/**
 * Extract package/app info from a file path
 */
function extractPackageInfo(filePath: string): { 
  type: "app" | "package" | "lib" | "unknown";
  name: string;
  subPath: string;
} {
  // Match patterns like apps/xxx, packages/xxx, libs/xxx
  const match = filePath.match(/(apps|packages|libs)\/([^/]+)\/(.+)/);
  if (match) {
    return {
      type: match[1] as "app" | "package" | "lib",
      name: match[2] ?? "unknown",
      subPath: match[3] ?? "",
    };
  }
  
  // Fallback for non-monorepo structures
  const parts = filePath.split("/");
  return {
    type: "unknown",
    name: parts[0] ?? "unknown",
    subPath: parts.slice(1).join("/"),
  };
}

/**
 * Infer a suggested name from the code pattern
 */
function inferSuggestedName(_pattern: string, matches: DuplicateMatch[]): string | undefined {
  // Try to extract function/component/schema name from content
  const firstMatch = matches[0];
  if (!firstMatch) return undefined;
  
  const content = firstMatch.content;
  
  // Look for common patterns - order matters! More specific first
  const patterns: Array<{ regex: RegExp; minLength: number }> = [
    // Schema definitions (Zod, etc)
    { regex: /(?:const|export const)\s+([A-Z]\w*Schema)\s*=/, minLength: 6 },
    // Type/interface definitions
    { regex: /(?:export\s+)?interface\s+([A-Z]\w+)/, minLength: 3 },
    { regex: /(?:export\s+)?type\s+([A-Z]\w+)\s*=/, minLength: 3 },
    // Class definitions
    { regex: /(?:export\s+)?class\s+([A-Z]\w+)/, minLength: 3 },
    // Function definitions (exported or async)
    { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w{3,})\s*[(<]/, minLength: 3 },
    // React component definitions
    { regex: /(?:export\s+)?(?:const|function)\s+([A-Z]\w+)\s*[=:].*(?:React|FC|Component|=>)/, minLength: 3 },
    // Named exports with PascalCase (likely important)
    { regex: /(?:export\s+)?const\s+([A-Z]\w{2,})\s*=/, minLength: 3 },
    // Arrow function assignments (camelCase, min 4 chars)
    { regex: /(?:export\s+)?const\s+([a-z][a-zA-Z]{3,})\s*=\s*(?:async\s*)?\(/, minLength: 4 },
  ];
  
  for (const { regex, minLength } of patterns) {
    const match = content.match(regex);
    if (match?.[1] && match[1].length >= minLength) {
      // Skip common variable names that aren't meaningful
      const skipNames = new Set(['result', 'data', 'error', 'response', 'value', 'item', 'index', 'key', 'match', 'pool', 'client', 'db']);
      if (!skipNames.has(match[1].toLowerCase())) {
        return match[1];
      }
    }
  }
  
  // Try to infer from file names (if they match across duplicates)
  const fileNames = matches.map(m => {
    const parts = m.filePath.split("/");
    const fileName = parts[parts.length - 1] ?? "";
    return fileName.replace(/\.(ts|tsx|js|jsx)$/, "");
  });
  
  // If all files have the same name, use that
  const uniqueNames = [...new Set(fileNames)];
  if (uniqueNames.length === 1 && uniqueNames[0] && uniqueNames[0].length >= 3) {
    // Convert to PascalCase if it looks like a good name
    const name = uniqueNames[0];
    if (name.includes("-") || name.includes("_")) {
      return name
        .split(/[-_]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
    }
    return name;
  }
  
  return undefined;
}

/**
 * Generate a refactoring suggestion for a duplicate group
 */
function generateRefactoringSuggestion(
  group: DuplicateGroup,
  _basePath: string
): RefactoringSuggestion {
  const matches = group.matches;
  
  // Extract package info from all matches
  const packageInfos = matches.map(m => extractPackageInfo(m.filePath));
  
  // Get unique packages/apps
  const uniquePackages = new Map<string, typeof packageInfos[0]>();
  for (const info of packageInfos) {
    const key = `${info.type}/${info.name}`;
    if (!uniquePackages.has(key)) {
      uniquePackages.set(key, info);
    }
  }
  
  const packageList = Array.from(uniquePackages.values());
  const suggestedName = inferSuggestedName(group.pattern, matches);
  
  // Case 1: All in same package - suggest extracting to local shared location
  if (packageList.length === 1 && packageList[0]) {
    const pkg = packageList[0];
    const subPaths = packageInfos.map(p => p.subPath);
    
    // Find common path prefix
    const commonPrefix = findCommonPrefix(subPaths);
    
    if (pkg.type === "app") {
      return {
        targetLocation: `${pkg.type}s/${pkg.name}/lib/shared/${commonPrefix || "utils"}`,
        reason: `All ${matches.length} occurrences are within ${pkg.name}`,
        confidence: "high",
        suggestedName,
      };
    } else {
      return {
        targetLocation: `${pkg.type}/${pkg.name}/src/shared`,
        reason: `All ${matches.length} occurrences are within ${pkg.name}`,
        confidence: "high",
        suggestedName,
      };
    }
  }
  
  // Case 2: Across multiple apps only - suggest packages/shared
  const hasOnlyApps = packageList.every(p => p.type === "app");
  if (hasOnlyApps) {
    // Check if there's already a shared package being used
    const appNames = packageList.map(p => p.name);
    
    return {
      targetLocation: "packages/shared/src",
      reason: `Duplicated across ${appNames.length} apps: ${appNames.join(", ")}`,
      confidence: "high",
      suggestedName,
    };
  }
  
  // Case 3: Mix of apps and packages - suggest the most appropriate package
  const packages = packageList.filter(p => p.type === "package");
  const apps = packageList.filter(p => p.type === "app");
  
  // Prefer existing packages over creating new ones
  if (packages.length > 0) {
    // Find the most "shared" package (one that's already imported by others)
    const sharedPackage = packages.find(p => 
      p.name === "shared" || p.name === "common" || p.name === "utils"
    ) ?? packages[0];
    if (!sharedPackage) return { targetLocation: "packages/shared/src", reason: "Duplicated across packages", confidence: "low", suggestedName };
    
    return {
      targetLocation: `packages/${sharedPackage.name}/src`,
      reason: `Already exists in ${sharedPackage.name}, also duplicated in ${apps.map(a => a.name).join(", ")}`,
      confidence: "medium",
      suggestedName,
    };
  }
  
  // Case 4: Only in libs - keep in libs
  const libs = packageList.filter(p => p.type === "lib");
  if (libs.length > 0) {
    return {
      targetLocation: `libs/shared/src`,
      reason: `Duplicated across ${libs.length} libraries`,
      confidence: "medium",
      suggestedName,
    };
  }
  
  // Default: suggest packages/shared
  return {
    targetLocation: "packages/shared/src",
    reason: `Duplicated across ${packageList.length} locations`,
    confidence: "low",
    suggestedName,
  };
}

/**
 * Find common path prefix
 */
function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return paths[0]?.split("/")[0] ?? "";
  
  const splitPaths = paths.map(p => p.split("/"));
  const minLength = Math.min(...splitPaths.map(p => p.length));
  
  const commonParts: string[] = [];
  for (let i = 0; i < minLength - 1; i++) {
    const part = splitPaths[0]?.[i];
    if (part && splitPaths.every(p => p[i] === part)) {
      commonParts.push(part);
    } else {
      break;
    }
  }
  
  return commonParts.join("/");
}


/**
 * Check if two line ranges overlap
 */
function rangesOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Remove duplicate groups that have significant file overlap
 * Uses range-based overlap detection, not just exact key matches
 */
function deduplicateGroups(groups: DuplicateGroup[]): DuplicateGroup[] {
  const result: DuplicateGroup[] = [];

  for (const group of groups) {
    // Check if this group's matches are mostly covered by existing groups
    let coveredCount = 0;
    
    for (const match of group.matches) {
      // Check if this match overlaps with any match in existing groups
      let isCovered = false;
      
      for (const existing of result) {
        for (const existingMatch of existing.matches) {
          if (
            match.filePath === existingMatch.filePath &&
            rangesOverlap(
              match.startLine, match.endLine,
              existingMatch.startLine, existingMatch.endLine
            )
          ) {
            isCovered = true;
            break;
          }
        }
        if (isCovered) break;
      }
      
      if (isCovered) coveredCount++;
    }

    // If less than threshold of matches are already covered, add this group
    if (coveredCount < group.matches.length * GROUP_OVERLAP_THRESHOLD) {
      result.push(group);
    }
  }

  return result;
}

export function findDeclarationDuplicates(
  declarations: Declaration[],
  minSimilarity: number
): DeclarationDuplicate[] {
  const duplicates: DeclarationDuplicate[] = [];
  let groupId = 0;

  const byType = new Map<DeclarationType, Declaration[]>();
  for (const decl of declarations) {
    const existing = byType.get(decl.type) ?? [];
    existing.push(decl);
    byType.set(decl.type, existing);
  }

  for (const [type, typeDecls] of byType) {
    const processed = new Set<number>();

    for (let i = 0; i < typeDecls.length; i++) {
      if (processed.has(i)) continue;
      
      const declA = typeDecls[i];
      if (!declA) continue;
      const matches: DeclarationDuplicate["matches"] = [{
        name: declA.name,
        filePath: declA.filePath,
        startLine: declA.startLine,
        endLine: declA.endLine,
        content: declA.content,
        exported: declA.exported,
      }];

      let bestNameSim = 0;
      let bestContentSim = 0;

      for (let j = i + 1; j < typeDecls.length; j++) {
        if (processed.has(j)) continue;
        
        const declB = typeDecls[j];
        if (!declB) continue;
        
        if (declA.filePath === declB.filePath && 
            Math.abs(declA.startLine - declB.startLine) < 5) continue;

        const nameSim = calculateNameSimilarity(declA.name, declB.name);
        const contentSim = calculateSimilarityFast(declA.normalized, declB.normalized);
        
        const combined = Math.max(
          nameSim * 0.4 + contentSim * 0.6,
          nameSim >= 0.9 ? nameSim : 0,
          contentSim >= 0.9 ? contentSim : 0
        );

        if (combined >= minSimilarity || (nameSim >= 0.8 && contentSim >= 0.5)) {
          processed.add(j);
          matches.push({
            name: declB.name,
            filePath: declB.filePath,
            startLine: declB.startLine,
            endLine: declB.endLine,
            content: declB.content,
            exported: declB.exported,
          });
          bestNameSim = Math.max(bestNameSim, nameSim);
          bestContentSim = Math.max(bestContentSim, contentSim);
        }
      }

      if (matches.length >= 2) {
        processed.add(i);
        
        const exported = matches.find(m => m.exported);
        const suggestion = exported
          ? `Import \`${exported.name}\` from \`${exported.filePath.replace(/.*\/(src|lib)\//, "")}\``
          : `Consider extracting \`${declA.name}\` to a shared location`;

        duplicates.push({
          id: groupId++,
          type,
          similarity: Math.max(bestNameSim, bestContentSim),
          nameSimilarity: bestNameSim,
          contentSimilarity: bestContentSim,
          matches,
          suggestion,
        });
      }
    }
  }

  duplicates.sort((a, b) => {
    const scoreA = a.matches.length * a.similarity;
    const scoreB = b.matches.length * b.similarity;
    return scoreB - scoreA;
  });

  return duplicates;
}
