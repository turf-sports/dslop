import { normalizeCode } from "./normalizer";

export type DeclarationType = "type" | "interface" | "function" | "class" | "const" | "enum";

export interface Declaration {
  type: DeclarationType;
  name: string;
  content: string;
  normalized: string;
  hash: string;
  filePath: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

const DECLARATION_PATTERNS: Array<{
  type: DeclarationType;
  regex: RegExp;
  nameGroup: number;
}> = [
  // Type aliases: type X = ... or export type X = ...
  { type: "type", regex: /^(export\s+)?type\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*=/m, nameGroup: 2 },
  // Interfaces: interface X { or export interface X {
  { type: "interface", regex: /^(export\s+)?interface\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*(?:extends\s+[^{]+)?\{/m, nameGroup: 2 },
  // Classes: class X { or export class X {
  { type: "class", regex: /^(export\s+)?(?:abstract\s+)?class\s+([A-Z]\w*)\s*(?:<[^>]*>)?\s*(?:extends\s+\w+)?\s*(?:implements\s+[^{]+)?\{/m, nameGroup: 2 },
  // Enums: enum X { or export enum X {
  { type: "enum", regex: /^(export\s+)?(?:const\s+)?enum\s+([A-Z]\w*)\s*\{/m, nameGroup: 2 },
  // Named functions: function x( or export function x( or export async function x(
  { type: "function", regex: /^(export\s+)?(?:async\s+)?function\s+([a-zA-Z]\w*)\s*(?:<[^>]*>)?\s*\(/m, nameGroup: 2 },
  // Arrow functions: const x = ( or export const x = async (
  { type: "function", regex: /^(export\s+)?const\s+([a-zA-Z]\w*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?\(/m, nameGroup: 2 },
  // Arrow functions with generics: const x = <T>(
  { type: "function", regex: /^(export\s+)?const\s+([a-zA-Z]\w*)\s*=\s*<[^>]+>\s*\(/m, nameGroup: 2 },
  // Constants (non-function): export const X = "..." or const X = {...}
  { type: "const", regex: /^(export\s+)?const\s+([A-Z][A-Z_0-9]*)\s*(?::\s*[^=]+)?\s*=/m, nameGroup: 2 },
];

function findMatchingBrace(content: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let inTemplate = false;
  
  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    const prevChar = content[i - 1];
    
    if (inString) {
      if (char === stringChar && prevChar !== "\\") {
        inString = false;
      }
      continue;
    }
    
    if (inTemplate) {
      if (char === "`" && prevChar !== "\\") {
        inTemplate = false;
      }
      continue;
    }
    
    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      continue;
    }
    
    if (char === "`") {
      inTemplate = true;
      continue;
    }
    
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  
  return -1;
}

function findStatementEnd(content: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  
  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    const prevChar = content[i - 1];
    
    if (inString) {
      if (char === stringChar && prevChar !== "\\") {
        inString = false;
      }
      continue;
    }
    
    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      continue;
    }
    
    if (char === "(" || char === "{" || char === "[") depth++;
    if (char === ")" || char === "}" || char === "]") depth--;
    
    if (depth === 0 && (char === ";" || char === "\n")) {
      const remaining = content.slice(i + 1).trimStart();
      if (!remaining.startsWith("|") && !remaining.startsWith("&")) {
        return i;
      }
    }
  }
  
  return content.length - 1;
}

const QUICK_CHECK = /^(export\s+)?(type|interface|class|enum|const|function|async\s+function)\s+/;

export function extractDeclarations(content: string, filePath: string): Declaration[] {
  const declarations: Declaration[] = [];
  const lines = content.split("\n");
  
  let lineStart = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const trimmed = line.trimStart();
    
    // Fast pre-check - skip lines that can't be declarations
    if (!QUICK_CHECK.test(trimmed)) {
      lineStart += line.length + 1;
      continue;
    }
    
    const remainingContent = content.slice(lineStart);
    
    for (const pattern of DECLARATION_PATTERNS) {
      const match = remainingContent.match(pattern.regex);
      
      if (match && match.index === 0) {
        const name = match[pattern.nameGroup];
        if (!name) continue;
        
        const exported = !!match[1];
        let endIndex: number;
        
        if (pattern.type === "interface" || pattern.type === "class" || pattern.type === "enum") {
          const braceStart = remainingContent.indexOf("{");
          if (braceStart === -1) continue;
          endIndex = findMatchingBrace(remainingContent, braceStart);
          if (endIndex === -1) endIndex = remainingContent.indexOf("\n", braceStart + 1);
        } else if (pattern.type === "type") {
          endIndex = findStatementEnd(remainingContent, match[0].length);
        } else {
          const hasArrow = remainingContent.slice(match[0].length, match[0].length + 100).includes("=>");
          if (hasArrow) {
            const arrowIndex = remainingContent.indexOf("=>", match[0].length);
            const afterArrow = remainingContent.slice(arrowIndex + 2).trimStart();
            if (afterArrow.startsWith("{")) {
              const braceStart = arrowIndex + 2 + (remainingContent.slice(arrowIndex + 2).length - afterArrow.length);
              endIndex = findMatchingBrace(remainingContent, braceStart);
            } else {
              endIndex = findStatementEnd(remainingContent, arrowIndex + 2);
            }
          } else {
            const braceIndex = remainingContent.indexOf("{", match[0].length);
            const newlineIndex = remainingContent.indexOf("\n", match[0].length);
            if (braceIndex !== -1 && (newlineIndex === -1 || braceIndex < newlineIndex)) {
              endIndex = findMatchingBrace(remainingContent, braceIndex);
            } else {
              endIndex = findStatementEnd(remainingContent, match[0].length);
            }
          }
        }
        
        if (endIndex === -1) endIndex = remainingContent.indexOf("\n\n");
        if (endIndex === -1) endIndex = Math.min(remainingContent.length - 1, 500);
        
        const declarationContent = remainingContent.slice(0, endIndex + 1).trim();
        const endLineIndex = lineIndex + declarationContent.split("\n").length - 1;
        
        const normalized = normalizeCode(declarationContent);
        
        declarations.push({
          type: pattern.type,
          name,
          content: declarationContent,
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: lineIndex + 1,
          endLine: endLineIndex + 1,
          exported,
        });
        
        break;
      }
    }
    
    lineStart += line.length + 1;
  }
  
  return declarations;
}

export function calculateNameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  if (aLower === bLower) return 0.95;
  
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
  
  const aWords = splitCamelCase(a);
  const bWords = splitCamelCase(b);
  
  const aSet = new Set(aWords.map(w => w.toLowerCase()));
  const bSet = new Set(bWords.map(w => w.toLowerCase()));
  
  let intersection = 0;
  for (const word of aSet) {
    if (bSet.has(word)) intersection++;
  }
  
  const union = aSet.size + bSet.size - intersection;
  const wordSimilarity = union > 0 ? intersection / union : 0;
  
  if (wordSimilarity > 0.5) return wordSimilarity * 0.9;
  
  const distance = levenshteinDistance(aLower, bLower);
  const maxLen = Math.max(aLower.length, bLower.length);
  return Math.max(0, 1 - distance / maxLen) * 0.7;
}

function splitCamelCase(str: string): string[] {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 0);
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1
        );
      }
    }
  }
  
  return matrix[b.length]![a.length]!;
}

