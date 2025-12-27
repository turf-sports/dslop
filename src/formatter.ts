import path from "node:path";
import type { ASTDuplicateGroup } from "./ast";

const MAX_PATH_LENGTH = 60;
const SEPARATOR = "─".repeat(80);

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const { reset, bold, dim, red, green, yellow, cyan, magenta, gray } = COLORS;

function truncatePath(filePath: string, basePath: string): string {
  const absoluteBase = path.resolve(basePath);
  let relativePath = filePath;
  
  if (filePath.startsWith(absoluteBase)) {
    relativePath = filePath.slice(absoluteBase.length);
    if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
  }

  if (relativePath.length > MAX_PATH_LENGTH) {
    const parts = relativePath.split(path.sep);
    if (parts.length > 3) {
      relativePath = `${parts[0]}/.../${parts.slice(-2).join("/")}`;
    }
  }

  return relativePath;
}

const TYPE_LABELS: Record<string, string> = {
  function: "Function",
  arrow: "Arrow Function",
  class: "Class",
  type: "Type",
  interface: "Interface",
};

export function formatASTDuplicates(groups: ASTDuplicateGroup[], basePath: string): string {
  if (groups.length === 0) return "";

  const lines: string[] = [];
  
  lines.push(SEPARATOR);
  lines.push(`${bold}DUPLICATE FUNCTIONS/TYPES${reset}`);
  lines.push(SEPARATOR);
  lines.push("");
  lines.push(`${dim}These have identical structure (ignoring variable names)${reset}`);
  lines.push("");

  for (let i = 0; i < Math.min(groups.length, 20); i++) {
    const group = groups[i];
    if (!group) continue;
    
    const typeLabel = TYPE_LABELS[group.type] || group.type;
    
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
    lines.push(`${dim}... and ${groups.length - 20} more${reset}`);
    lines.push("");
  }

  lines.push(SEPARATOR);
  lines.push(`${bold}Summary${reset}: ${groups.length} duplicate groups, ${groups.reduce((sum, g) => sum + g.matches.length, 0)} total occurrences`);
  lines.push(SEPARATOR);

  return lines.join("\n");
}
