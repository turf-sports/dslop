import path from "node:path";
import type { ASTDuplicateGroup } from "./ast";
import type { DeclarationDuplicate, DuplicateGroup } from "./detector";
import {
  MAX_PATH_DISPLAY_LENGTH,
  MAX_MATCHES_IN_SUMMARY,
  MAX_GROUPS_DETAILED,
  SECTION_SEPARATOR,
  COLORS,
  CODE_PREVIEW_CONTEXT_LINES,
} from "./constants";

const { reset, bold, dim, red, green, yellow, cyan, magenta, gray } = COLORS;

/**
 * Truncate a path for display
 */
function truncatePath(filePath: string, basePath: string): string {
  // Make path relative to basePath
  const absoluteBase = path.resolve(basePath);
  let relativePath = filePath;
  
  if (filePath.startsWith(absoluteBase)) {
    relativePath = filePath.slice(absoluteBase.length);
    if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
      relativePath = relativePath.slice(1);
    }
  }

  // Truncate if too long
  if (relativePath.length > MAX_PATH_DISPLAY_LENGTH) {
    const parts = relativePath.split(path.sep);
    if (parts.length > 3) {
      // Keep first and last parts, truncate middle
      relativePath = `${parts[0]}/.../${parts.slice(-2).join("/")}`;
    }
  }

  return relativePath;
}

/**
 * Get a similarity badge with color
 */
function getSimilarityBadge(similarity: number): string {
  const percent = Math.round(similarity * 100);
  if (similarity === 1) {
    return `${red}${bold}EXACT${reset}`;
  } else if (similarity >= 0.9) {
    return `${yellow}${percent}%${reset}`;
  } else {
    return `${cyan}${percent}%${reset}`;
  }
}

/**
 * Format a single duplicate group for display
 */
function formatGroup(group: DuplicateGroup, index: number, basePath: string): string {
  const lines: string[] = [];
  
  // Header
  const badge = getSimilarityBadge(group.similarity);
  const impact = group.occurrences * group.lineCount;
  
  lines.push(`${bold}Group ${index + 1}${reset} │ ${badge} │ ${group.lineCount} lines × ${group.occurrences} occurrences = ${green}${impact} lines${reset} of duplication`);
  lines.push("");

  // Show matches (limited to MAX_MATCHES_IN_SUMMARY)
  const matchesToShow = group.matches.slice(0, MAX_MATCHES_IN_SUMMARY);
  const hasMore = group.matches.length > MAX_MATCHES_IN_SUMMARY;

  for (const match of matchesToShow) {
    const displayPath = truncatePath(match.filePath, basePath);
    lines.push(`  ${dim}├─${reset} ${displayPath}:${yellow}${match.startLine}${reset}-${yellow}${match.endLine}${reset}`);
  }

  if (hasMore) {
    lines.push(`  ${dim}└─${reset} ${gray}... and ${group.matches.length - MAX_MATCHES_IN_SUMMARY} more${reset}`);
  }

  // Show a snippet of the code (first few lines)
  const firstMatch = group.matches[0];
  if (firstMatch) {
    lines.push("");
    lines.push(`  ${dim}Code preview:${reset}`);
    
    const previewLines = firstMatch.content
      .split("\n")
      .slice(0, CODE_PREVIEW_CONTEXT_LINES)
      .map((line) => `  ${gray}│${reset} ${dim}${line.slice(0, 80)}${line.length > 80 ? "..." : ""}${reset}`);
    
    lines.push(...previewLines);
    
    if (firstMatch.content.split("\n").length > CODE_PREVIEW_CONTEXT_LINES) {
      lines.push(`  ${gray}│${reset} ${dim}...${reset}`);
    }
  }

  // Show refactoring suggestion if available
  if (group.suggestion) {
    lines.push("");
    const confidenceColor = group.suggestion.confidence === "high" ? green 
      : group.suggestion.confidence === "medium" ? yellow 
      : gray;
    
    lines.push(`  ${magenta}→ Suggestion:${reset} Move to ${cyan}${group.suggestion.targetLocation}${reset}`);
    if (group.suggestion.suggestedName) {
      lines.push(`  ${dim}  Name: ${group.suggestion.suggestedName}${reset}`);
    }
    lines.push(`  ${dim}  ${group.suggestion.reason} ${confidenceColor}[${group.suggestion.confidence}]${reset}`);
  }

  return lines.join("\n");
}

/**
 * Format all duplicate groups for display
 */
export function formatOutput(groups: DuplicateGroup[], basePath: string): string {
  if (groups.length === 0) {
    return `${green}No duplicates found!${reset}`;
  }

  const lines: string[] = [];
  
  lines.push(SECTION_SEPARATOR);
  lines.push(`${bold}DUPLICATE CODE DETECTED${reset}`);
  lines.push(SECTION_SEPARATOR);
  lines.push("");

  // Show detailed groups (limited)
  const groupsToShow = groups.slice(0, MAX_GROUPS_DETAILED);
  
  for (let i = 0; i < groupsToShow.length; i++) {
    const group = groupsToShow[i];
    if (group) {
      lines.push(formatGroup(group, i, basePath));
      lines.push("");
    }
  }

  if (groups.length > MAX_GROUPS_DETAILED) {
    lines.push(`${dim}... and ${groups.length - MAX_GROUPS_DETAILED} more groups${reset}`);
    lines.push("");
  }

  lines.push(SECTION_SEPARATOR);

  return lines.join("\n");
}

/**
 * Format statistics summary
 */
export function formatStats(groups: DuplicateGroup[]): string {
  if (groups.length === 0) {
    return "";
  }

  const totalDuplicateLines = groups.reduce(
    (sum, g) => sum + g.lineCount * g.occurrences,
    0
  );
  
  const exactMatches = groups.filter((g) => g.similarity === 1).length;
  const similarMatches = groups.length - exactMatches;
  
  const avgSimilarity = groups.reduce((sum, g) => sum + g.similarity, 0) / groups.length;
  
  // Count unique files affected
  const uniqueFiles = new Set<string>();
  for (const group of groups) {
    for (const match of group.matches) {
      uniqueFiles.add(match.filePath);
    }
  }

  const lines: string[] = [];
  
  lines.push(`${bold}SUMMARY${reset}`);
  lines.push(SECTION_SEPARATOR);
  lines.push(`  Total duplicate groups:    ${bold}${groups.length}${reset}`);
  lines.push(`  Exact matches:             ${bold}${exactMatches}${reset}`);
  lines.push(`  Similar matches:           ${bold}${similarMatches}${reset}`);
  lines.push(`  Files affected:            ${bold}${uniqueFiles.size}${reset}`);
  lines.push(`  Total duplicate lines:     ${red}${bold}${totalDuplicateLines.toLocaleString()}${reset}`);
  lines.push(`  Average similarity:        ${bold}${Math.round(avgSimilarity * 100)}%${reset}`);
  lines.push(SECTION_SEPARATOR);
  lines.push("");
  lines.push(`${dim}Tip: Use --json for machine-readable output${reset}`);

  return lines.join("\n");
}

/**
 * Format groups as a simple list (for quick overview)
 */
export function formatQuickList(groups: DuplicateGroup[], basePath: string): string {
  const lines: string[] = [];
  
  for (const group of groups) {
    const badge = group.similarity === 1 ? "EXACT" : `${Math.round(group.similarity * 100)}%`;
    const files = group.matches
      .slice(0, 3)
      .map((m) => truncatePath(m.filePath, basePath))
      .join(", ");
    const more = group.matches.length > 3 ? ` +${group.matches.length - 3}` : "";
    
    lines.push(`[${badge}] ${group.lineCount}L × ${group.occurrences}: ${files}${more}`);
  }

  return lines.join("\n");
}

const TYPE_LABELS: Record<string, string> = {
  type: "Type",
  interface: "Interface", 
  function: "Function",
  class: "Class",
  const: "Constant",
  enum: "Enum",
};

function formatDeclarationGroup(group: DeclarationDuplicate, index: number, basePath: string): string {
  const lines: string[] = [];
  
  const typeLabel = TYPE_LABELS[group.type] || group.type;
  const simBadge = group.similarity >= 0.95 
    ? `${red}${bold}EXACT${reset}` 
    : `${yellow}${Math.round(group.similarity * 100)}%${reset}`;
  
  lines.push(`${bold}${typeLabel} ${index + 1}${reset} │ ${simBadge} │ ${group.matches.length} occurrences`);
  
  if (group.nameSimilarity > 0 && group.nameSimilarity < 1) {
    lines.push(`  ${dim}Name similarity: ${Math.round(group.nameSimilarity * 100)}%${reset}`);
  }
  
  lines.push("");

  for (const match of group.matches.slice(0, 5)) {
    const displayPath = truncatePath(match.filePath, basePath);
    const exportBadge = match.exported ? `${green}exported${reset}` : `${gray}local${reset}`;
    lines.push(`  ${dim}├─${reset} ${cyan}${match.name}${reset} [${exportBadge}]`);
    lines.push(`     ${displayPath}:${yellow}${match.startLine}${reset}-${yellow}${match.endLine}${reset}`);
  }

  if (group.matches.length > 5) {
    lines.push(`  ${dim}└─${reset} ${gray}... and ${group.matches.length - 5} more${reset}`);
  }

  lines.push("");
  lines.push(`  ${magenta}→${reset} ${group.suggestion}`);

  return lines.join("\n");
}

export function formatDeclarations(groups: DeclarationDuplicate[], basePath: string): string {
  if (groups.length === 0) {
    return "";
  }

  const lines: string[] = [];
  
  lines.push("");
  lines.push(SECTION_SEPARATOR);
  lines.push(`${bold}DUPLICATE DECLARATIONS${reset}`);
  lines.push(SECTION_SEPARATOR);
  lines.push("");

  const byType = new Map<string, DeclarationDuplicate[]>();
  for (const group of groups) {
    const existing = byType.get(group.type) || [];
    existing.push(group);
    byType.set(group.type, existing);
  }

  let globalIndex = 0;
  for (const [type, typeGroups] of byType) {
    const typeLabel = TYPE_LABELS[type] || type;
    lines.push(`${bold}${typeLabel}s (${typeGroups.length})${reset}`);
    lines.push("");
    
    for (const group of typeGroups.slice(0, 10)) {
      lines.push(formatDeclarationGroup(group, globalIndex++, basePath));
      lines.push("");
    }
    
    if (typeGroups.length > 10) {
      lines.push(`${dim}... and ${typeGroups.length - 10} more ${typeLabel.toLowerCase()}s${reset}`);
      lines.push("");
    }
  }

  lines.push(SECTION_SEPARATOR);
  
  const totalDups = groups.reduce((sum, g) => sum + g.matches.length, 0);
  lines.push(`${bold}Declaration Summary${reset}`);
  lines.push(`  Duplicate groups: ${bold}${groups.length}${reset}`);
  lines.push(`  Total occurrences: ${bold}${totalDups}${reset}`);
  lines.push(SECTION_SEPARATOR);

  return lines.join("\n");
}

const AST_TYPE_LABELS: Record<string, string> = {
  function: "Function",
  arrow: "Arrow Function",
  class: "Class",
  type: "Type",
  interface: "Interface",
};

export function formatASTDuplicates(groups: ASTDuplicateGroup[], basePath: string): string {
  if (groups.length === 0) return "";

  const lines: string[] = [];
  
  lines.push("");
  lines.push(SECTION_SEPARATOR);
  lines.push(`${bold}DUPLICATE FUNCTIONS (AST-based)${reset}`);
  lines.push(SECTION_SEPARATOR);
  lines.push("");
  lines.push(`${dim}These functions have identical structure (ignoring variable names)${reset}`);
  lines.push("");

  for (let i = 0; i < Math.min(groups.length, 20); i++) {
    const group = groups[i];
    if (!group) continue;
    const typeLabel = AST_TYPE_LABELS[group.type] || group.type;
    
    lines.push(`${bold}${typeLabel} ${i + 1}${reset} │ ${red}${bold}IDENTICAL${reset} │ ${group.matches.length} occurrences`);
    lines.push("");

    for (const match of group.matches.slice(0, 5)) {
      const displayPath = truncatePath(match.filePath, basePath);
      const exportBadge = match.exported ? `${green}exported${reset}` : `${gray}local${reset}`;
      lines.push(`  ${dim}├─${reset} ${cyan}${match.name}${reset} [${exportBadge}]`);
      lines.push(`     ${displayPath}:${yellow}${match.startLine}${reset}-${yellow}${match.endLine}${reset}`);
    }

    if (group.matches.length > 5) {
      lines.push(`  ${dim}└─${reset} ${gray}... and ${group.matches.length - 5} more${reset}`);
    }

    const exported = group.matches.find(m => m.exported);
    if (exported) {
      lines.push("");
      lines.push(`  ${magenta}→${reset} Import \`${exported.name}\` from \`${truncatePath(exported.filePath, basePath)}\``);
    } else {
      lines.push("");
      lines.push(`  ${magenta}→${reset} Extract to shared module`);
    }

    lines.push("");
  }

  if (groups.length > 20) {
    lines.push(`${dim}... and ${groups.length - 20} more duplicate functions${reset}`);
    lines.push("");
  }

  lines.push(SECTION_SEPARATOR);
  const totalDups = groups.reduce((sum, g) => sum + g.matches.length, 0);
  lines.push(`${bold}AST Summary${reset}`);
  lines.push(`  Duplicate groups: ${bold}${groups.length}${reset}`);
  lines.push(`  Total occurrences: ${bold}${totalDups}${reset}`);
  lines.push(SECTION_SEPARATOR);

  return lines.join("\n");
}
