import {
  STRING_PLACEHOLDER,
  TEMPLATE_PLACEHOLDER,
  NUMBER_PLACEHOLDER,
  COLOR_PLACEHOLDER,
  PRESERVED_KEYWORDS,
} from "./constants";

export function normalizeCode(code: string): string {
  let normalized = code;

  // 1. Replace string literals (both single and double quoted)
  // Handle escaped quotes within strings
  normalized = normalized.replace(/"(?:[^"\\]|\\.)*"/g, `"${STRING_PLACEHOLDER}"`);
  normalized = normalized.replace(/'(?:[^'\\]|\\.)*'/g, `'${STRING_PLACEHOLDER}'`);
  
  // 2. Replace template literals
  normalized = normalized.replace(/`(?:[^`\\]|\\.)*`/g, `\`${TEMPLATE_PLACEHOLDER}\``);

  // 3. Replace numeric literals (integers and floats)
  // Be careful not to replace numbers in identifiers
  normalized = normalized.replace(/\b\d+\.?\d*\b/g, NUMBER_PLACEHOLDER);

  // 4. Replace hex color codes
  normalized = normalized.replace(/#[0-9a-fA-F]{3,8}\b/g, COLOR_PLACEHOLDER);

  // 5. Normalize multiple spaces to single space (but preserve newlines)
  normalized = normalized.replace(/[ \t]+/g, ' ');

  // 6. Trim trailing whitespace from lines
  normalized = normalized
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  // 7. Remove empty lines (compress multiple newlines to single)
  normalized = normalized.replace(/\n\s*\n/g, '\n');

  return normalized;
}

export function normalizeCodeAggressive(code: string): string {
  let normalized = normalizeCode(code);

  // Track seen identifiers and map to placeholders
  const identifierMap = new Map<string, string>();
  let identifierCounter = 0;

  // Match identifiers (camelCase, PascalCase, snake_case, SCREAMING_CASE)
  // But skip common keywords and built-ins from PRESERVED_KEYWORDS
  normalized = normalized.replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, (match) => {
    if (PRESERVED_KEYWORDS.has(match)) {
      return match;
    }
    
    if (!identifierMap.has(match)) {
      identifierMap.set(match, `<ID${identifierCounter++}>`);
    }
    return identifierMap.get(match) ?? match;
  });

  return normalized;
}

export function getCodeStructure(code: string): string {
  let structure = code;

  // Replace all identifiers with generic placeholder
  structure = structure.replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, '_');
  
  // Replace strings and numbers
  structure = structure.replace(/"[^"]*"/g, 'S');
  structure = structure.replace(/'[^']*'/g, 'S');
  structure = structure.replace(/`[^`]*`/g, 'S');
  structure = structure.replace(/\b\d+\.?\d*\b/g, 'N');
  
  // Remove all whitespace
  structure = structure.replace(/\s+/g, '');

  return structure;
}
