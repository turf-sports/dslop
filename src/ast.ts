import { parseSync } from "oxc-parser";

export interface ASTBlock {
  type: "function" | "class" | "type" | "interface" | "arrow";
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
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Simple AST normalizer - replaces identifiers with placeholders
function normalizeAST(node: any, idMap: Map<string, string>, counter: { val: number }): string {
  if (!node) return "";
  
  const preserved = new Set([
    "undefined", "null", "true", "false", "console", "Math", "Date", "Array", 
    "Object", "String", "Number", "Boolean", "Promise", "Map", "Set",
    "React", "useState", "useEffect", "useCallback", "useMemo", "useRef",
  ]);

  if (node.type === "Identifier") {
    const name = node.name;
    if (preserved.has(name)) return name;
    if (!idMap.has(name)) idMap.set(name, `$${counter.val++}`);
    return idMap.get(name)!;
  }

  if (node.type === "StringLiteral" || node.type === "Literal" && typeof node.value === "string") return '"S"';
  if (node.type === "NumericLiteral" || node.type === "Literal" && typeof node.value === "number") return "N";
  if (node.type === "BooleanLiteral") return String(node.value);
  if (node.type === "NullLiteral") return "null";

  if (node.type === "BlockStatement") {
    return `{${node.body.map((n: any) => normalizeAST(n, idMap, counter)).join(";")}}`;
  }

  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
    const params = (node.params || []).map((p: any) => normalizeAST(p, idMap, counter)).join(",");
    const body = node.body ? normalizeAST(node.body, idMap, counter) : "";
    const async = node.async ? "async " : "";
    return `${async}function(${params})${body}`;
  }

  if (node.type === "ArrowFunctionExpression") {
    const params = (node.params || []).map((p: any) => normalizeAST(p, idMap, counter)).join(",");
    const body = normalizeAST(node.body, idMap, counter);
    const async = node.async ? "async " : "";
    return `${async}(${params})=>${body}`;
  }

  if (node.type === "VariableDeclaration") {
    return `${node.kind} ${node.declarations.map((d: any) => normalizeAST(d, idMap, counter)).join(",")}`;
  }

  if (node.type === "VariableDeclarator") {
    const id = normalizeAST(node.id, idMap, counter);
    const init = node.init ? `=${normalizeAST(node.init, idMap, counter)}` : "";
    return `${id}${init}`;
  }

  if (node.type === "ReturnStatement") {
    return `return ${node.argument ? normalizeAST(node.argument, idMap, counter) : ""}`;
  }

  if (node.type === "IfStatement") {
    const test = normalizeAST(node.test, idMap, counter);
    const consequent = normalizeAST(node.consequent, idMap, counter);
    const alternate = node.alternate ? ` else ${normalizeAST(node.alternate, idMap, counter)}` : "";
    return `if(${test})${consequent}${alternate}`;
  }

  if (node.type === "ForStatement") {
    const init = node.init ? normalizeAST(node.init, idMap, counter) : "";
    const test = node.test ? normalizeAST(node.test, idMap, counter) : "";
    const update = node.update ? normalizeAST(node.update, idMap, counter) : "";
    const body = normalizeAST(node.body, idMap, counter);
    return `for(${init};${test};${update})${body}`;
  }

  if (node.type === "CallExpression") {
    const callee = normalizeAST(node.callee, idMap, counter);
    const args = (node.arguments || []).map((a: any) => normalizeAST(a, idMap, counter)).join(",");
    return `${callee}(${args})`;
  }

  if (node.type === "MemberExpression") {
    const obj = normalizeAST(node.object, idMap, counter);
    const prop = node.computed 
      ? `[${normalizeAST(node.property, idMap, counter)}]`
      : `.${normalizeAST(node.property, idMap, counter)}`;
    return obj + prop;
  }

  if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
    return `(${normalizeAST(node.left, idMap, counter)}${node.operator}${normalizeAST(node.right, idMap, counter)})`;
  }

  if (node.type === "UnaryExpression") {
    return `${node.operator}${normalizeAST(node.argument, idMap, counter)}`;
  }

  if (node.type === "ConditionalExpression") {
    return `(${normalizeAST(node.test, idMap, counter)}?${normalizeAST(node.consequent, idMap, counter)}:${normalizeAST(node.alternate, idMap, counter)})`;
  }

  if (node.type === "AssignmentExpression") {
    return `${normalizeAST(node.left, idMap, counter)}${node.operator}${normalizeAST(node.right, idMap, counter)}`;
  }

  if (node.type === "ObjectExpression") {
    const props = (node.properties || []).map((p: any) => normalizeAST(p, idMap, counter)).join(",");
    return `{${props}}`;
  }

  if (node.type === "Property" || node.type === "ObjectProperty") {
    const key = normalizeAST(node.key, idMap, counter);
    const value = normalizeAST(node.value, idMap, counter);
    return node.shorthand ? key : `${key}:${value}`;
  }

  if (node.type === "ArrayExpression") {
    return `[${(node.elements || []).map((e: any) => e ? normalizeAST(e, idMap, counter) : "").join(",")}]`;
  }

  if (node.type === "SpreadElement") {
    return `...${normalizeAST(node.argument, idMap, counter)}`;
  }

  if (node.type === "AwaitExpression") {
    return `await ${normalizeAST(node.argument, idMap, counter)}`;
  }

  if (node.type === "ExpressionStatement") {
    return normalizeAST(node.expression, idMap, counter);
  }

  // TypeScript - skip type annotations for normalization
  if (node.type?.startsWith("TS")) return "";

  return node.type || "";
}

function getLineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

export function extractASTBlocks(content: string, filePath: string): ASTBlock[] {
  const blocks: ASTBlock[] = [];
  
  try {
    const result = parseSync(filePath, content);
    const program = result.program;

    for (let i = 0; i < program.body.length; i++) {
      const node = program.body[i] as any;
      const isExported = node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration";
      const actualNode = isExported ? node.declaration : node;
      
      if (!actualNode) continue;

      if (actualNode.type === "FunctionDeclaration" && actualNode.id) {
        const idMap = new Map<string, string>();
        const counter = { val: 0 };
        const normalized = normalizeAST(actualNode, idMap, counter);
        
        blocks.push({
          type: "function",
          name: actualNode.id.name,
          content: content.slice(actualNode.start, actualNode.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }

      if (actualNode.type === "VariableDeclaration") {
        for (const decl of actualNode.declarations) {
          if (!decl.id?.name || !decl.init) continue;
          if (decl.init.type !== "ArrowFunctionExpression" && decl.init.type !== "FunctionExpression") continue;
          
          const idMap = new Map<string, string>();
          const counter = { val: 0 };
          const normalized = normalizeAST(decl.init, idMap, counter);
          
          blocks.push({
            type: "arrow",
            name: decl.id.name,
            content: content.slice(decl.start, decl.end),
            normalized,
            hash: simpleHash(normalized),
            filePath,
            startLine: getLineNumber(content, decl.start),
            endLine: getLineNumber(content, decl.end),
            exported: isExported,
          });
        }
      }

      if (actualNode.type === "TSInterfaceDeclaration") {
        const nodeContent = content.slice(actualNode.start, actualNode.end);
        blocks.push({
          type: "interface",
          name: actualNode.id.name,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }

      if (actualNode.type === "TSTypeAliasDeclaration") {
        const nodeContent = content.slice(actualNode.start, actualNode.end);
        blocks.push({
          type: "type",
          name: actualNode.id.name,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }

      if (actualNode.type === "ClassDeclaration" && actualNode.id) {
        const idMap = new Map<string, string>();
        const counter = { val: 0 };
        const normalized = `class{}`; // Simplified for now
        
        blocks.push({
          type: "class",
          name: actualNode.id.name,
          content: content.slice(actualNode.start, actualNode.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }
    }
  } catch {
    // Parse error - skip this file
  }

  return blocks;
}

export interface ASTDuplicateGroup {
  id: number;
  type: ASTBlock["type"];
  similarity: number;
  matches: Array<{
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    exported: boolean;
  }>;
}

export function findASTDuplicates(blocks: ASTBlock[], _minSimilarity: number): ASTDuplicateGroup[] {
  const groups: ASTDuplicateGroup[] = [];
  const hashGroups = new Map<string, ASTBlock[]>();

  for (const block of blocks) {
    const existing = hashGroups.get(block.hash) ?? [];
    existing.push(block);
    hashGroups.set(block.hash, existing);
  }

  let groupId = 0;
  for (const [, matches] of hashGroups) {
    if (matches.length < 2) continue;

    const uniqueMatches = matches.filter((m, i) => 
      !matches.slice(0, i).some(prev => 
        prev.filePath === m.filePath && 
        Math.abs(prev.startLine - m.startLine) < 3
      )
    );

    if (uniqueMatches.length < 2) continue;

    const uniqueFiles = new Set(uniqueMatches.map(m => m.filePath));
    if (uniqueFiles.size < 2) continue;

    const firstMatch = uniqueMatches[0];
    if (!firstMatch) continue;
    
    groups.push({
      id: groupId++,
      type: firstMatch.type,
      similarity: 1,
      matches: uniqueMatches.map(m => ({
        name: m.name,
        filePath: m.filePath,
        startLine: m.startLine,
        endLine: m.endLine,
        content: m.content,
        exported: m.exported,
      })),
    });
  }

  groups.sort((a, b) => b.matches.length - a.matches.length);
  return groups;
}

