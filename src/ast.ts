import { parseSync } from "oxc-parser";
import type { Program } from "@oxc-project/types";

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

// Generic AST node type - oxc nodes have varying shapes
interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

const PRESERVED_IDENTIFIERS = new Set([
  "undefined", "null", "true", "false", "console", "Math", "Date", "Array", 
  "Object", "String", "Number", "Boolean", "Promise", "Map", "Set",
  "React", "useState", "useEffect", "useCallback", "useMemo", "useRef",
]);

function normalizeAST(node: Node | null, idMap: Map<string, string>, counter: { val: number }): string {
  if (!node) return "";
  
  const type = node.type;

  // Identifiers
  if (type === "Identifier") {
    const name = node.name as string;
    if (PRESERVED_IDENTIFIERS.has(name)) return name;
    if (!idMap.has(name)) idMap.set(name, `$${counter.val++}`);
    return idMap.get(name) ?? name;
  }

  // Literals
  if (type === "StringLiteral") return '"S"';
  if (type === "NumericLiteral") return "N";
  if (type === "BooleanLiteral") return String(node.value);
  if (type === "NullLiteral") return "null";

  // Block
  if (type === "BlockStatement") {
    const body = node.body as Node[];
    return `{${body.map(n => normalizeAST(n, idMap, counter)).join(";")}}`;
  }

  // Functions
  if (type === "FunctionDeclaration" || type === "FunctionExpression") {
    const params = (node.params as Node[]).map(p => normalizeAST(p, idMap, counter)).join(",");
    const body = node.body ? normalizeAST(node.body as Node, idMap, counter) : "";
    const async = node.async ? "async " : "";
    return `${async}function(${params})${body}`;
  }

  if (type === "ArrowFunctionExpression") {
    const params = (node.params as Node[]).map(p => normalizeAST(p, idMap, counter)).join(",");
    const body = normalizeAST(node.body as Node, idMap, counter);
    const async = node.async ? "async " : "";
    return `${async}(${params})=>${body}`;
  }

  // Variables
  if (type === "VariableDeclaration") {
    const declarations = node.declarations as Node[];
    return `${node.kind} ${declarations.map(d => normalizeAST(d, idMap, counter)).join(",")}`;
  }

  if (type === "VariableDeclarator") {
    const id = normalizeAST(node.id as Node, idMap, counter);
    const init = node.init ? `=${normalizeAST(node.init as Node, idMap, counter)}` : "";
    return `${id}${init}`;
  }

  // Statements
  if (type === "ReturnStatement") {
    return `return ${node.argument ? normalizeAST(node.argument as Node, idMap, counter) : ""}`;
  }

  if (type === "IfStatement") {
    const test = normalizeAST(node.test as Node, idMap, counter);
    const consequent = normalizeAST(node.consequent as Node, idMap, counter);
    const alternate = node.alternate ? ` else ${normalizeAST(node.alternate as Node, idMap, counter)}` : "";
    return `if(${test})${consequent}${alternate}`;
  }

  if (type === "ForStatement") {
    const init = node.init ? normalizeAST(node.init as Node, idMap, counter) : "";
    const test = node.test ? normalizeAST(node.test as Node, idMap, counter) : "";
    const update = node.update ? normalizeAST(node.update as Node, idMap, counter) : "";
    const body = normalizeAST(node.body as Node, idMap, counter);
    return `for(${init};${test};${update})${body}`;
  }

  if (type === "ExpressionStatement") {
    return normalizeAST(node.expression as Node, idMap, counter);
  }

  // Expressions
  if (type === "CallExpression") {
    const callee = normalizeAST(node.callee as Node, idMap, counter);
    const args = (node.arguments as Node[]).map(a => normalizeAST(a, idMap, counter)).join(",");
    return `${callee}(${args})`;
  }

  if (type === "MemberExpression" || type === "StaticMemberExpression" || type === "ComputedMemberExpression") {
    const obj = normalizeAST(node.object as Node, idMap, counter);
    const computed = type === "ComputedMemberExpression" || node.computed;
    const prop = computed 
      ? `[${normalizeAST(node.property as Node, idMap, counter)}]`
      : `.${normalizeAST(node.property as Node, idMap, counter)}`;
    return obj + prop;
  }

  if (type === "BinaryExpression" || type === "LogicalExpression") {
    const left = normalizeAST(node.left as Node, idMap, counter);
    const right = normalizeAST(node.right as Node, idMap, counter);
    return `(${left}${node.operator}${right})`;
  }

  if (type === "UnaryExpression") {
    return `${node.operator}${normalizeAST(node.argument as Node, idMap, counter)}`;
  }

  if (type === "ConditionalExpression") {
    const test = normalizeAST(node.test as Node, idMap, counter);
    const consequent = normalizeAST(node.consequent as Node, idMap, counter);
    const alternate = normalizeAST(node.alternate as Node, idMap, counter);
    return `(${test}?${consequent}:${alternate})`;
  }

  if (type === "AssignmentExpression") {
    const left = normalizeAST(node.left as Node, idMap, counter);
    const right = normalizeAST(node.right as Node, idMap, counter);
    return `${left}${node.operator}${right}`;
  }

  if (type === "ObjectExpression") {
    const props = (node.properties as Node[]).map(p => normalizeAST(p, idMap, counter)).join(",");
    return `{${props}}`;
  }

  if (type === "Property") {
    const key = normalizeAST(node.key as Node, idMap, counter);
    const value = normalizeAST(node.value as Node, idMap, counter);
    return node.shorthand ? key : `${key}:${value}`;
  }

  if (type === "ArrayExpression") {
    const elements = (node.elements as (Node | null)[]).map(e => normalizeAST(e, idMap, counter)).join(",");
    return `[${elements}]`;
  }

  if (type === "SpreadElement") {
    return `...${normalizeAST(node.argument as Node, idMap, counter)}`;
  }

  if (type === "AwaitExpression") {
    return `await ${normalizeAST(node.argument as Node, idMap, counter)}`;
  }

  // Patterns
  if (type === "FormalParameter") {
    return normalizeAST(node.pattern as Node, idMap, counter);
  }

  // TypeScript - skip type annotations
  if (type.startsWith("TS")) return "";

  return type;
}

function getLineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

export function extractASTBlocks(content: string, filePath: string): ASTBlock[] {
  const blocks: ASTBlock[] = [];
  
  try {
    const result = parseSync(filePath, content);
    const program: Program = result.program;

    for (const node of program.body) {
      const n = node as unknown as Node;
      const isExported = n.type === "ExportNamedDeclaration" || n.type === "ExportDefaultDeclaration";
      const actualNode = isExported ? (n.declaration as Node) : n;
      
      if (!actualNode) continue;

      // Function declarations
      if (actualNode.type === "FunctionDeclaration") {
        const id = actualNode.id as Node | null;
        if (!id) continue;
        
        const idMap = new Map<string, string>();
        const counter = { val: 0 };
        const normalized = normalizeAST(actualNode, idMap, counter);
        
        blocks.push({
          type: "function",
          name: id.name as string,
          content: content.slice(actualNode.start, actualNode.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }

      // Arrow functions and function expressions
      if (actualNode.type === "VariableDeclaration") {
        const declarations = actualNode.declarations as Node[];
        for (const decl of declarations) {
          const id = decl.id as Node | null;
          const init = decl.init as Node | null;
          if (!id || !init) continue;
          if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") continue;
          
          const idMap = new Map<string, string>();
          const counter = { val: 0 };
          const normalized = normalizeAST(init, idMap, counter);
          
          blocks.push({
            type: "arrow",
            name: id.name as string,
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

      // TypeScript interfaces
      if (actualNode.type === "TSInterfaceDeclaration") {
        const id = actualNode.id as Node;
        const nodeContent = content.slice(actualNode.start, actualNode.end);
        blocks.push({
          type: "interface",
          name: id.name as string,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }

      // TypeScript type aliases
      if (actualNode.type === "TSTypeAliasDeclaration") {
        const id = actualNode.id as Node;
        const nodeContent = content.slice(actualNode.start, actualNode.end);
        blocks.push({
          type: "type",
          name: id.name as string,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: getLineNumber(content, actualNode.start),
          endLine: getLineNumber(content, actualNode.end),
          exported: isExported,
        });
      }

      // Classes
      if (actualNode.type === "ClassDeclaration") {
        const id = actualNode.id as Node | null;
        if (!id) continue;
        
        const normalized = `class{}`;
        
        blocks.push({
          type: "class",
          name: id.name as string,
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
  const hashGroups = new Map<string, ASTBlock[]>();

  for (const block of blocks) {
    const existing = hashGroups.get(block.hash) ?? [];
    existing.push(block);
    hashGroups.set(block.hash, existing);
  }

  const groups: ASTDuplicateGroup[] = [];
  let groupId = 0;

  for (const [, matches] of hashGroups) {
    if (matches.length < 2) continue;

    // Filter duplicates from same location
    const uniqueMatches = matches.filter((m, i) => 
      !matches.slice(0, i).some(prev => 
        prev.filePath === m.filePath && 
        Math.abs(prev.startLine - m.startLine) < 3
      )
    );

    if (uniqueMatches.length < 2) continue;

    // Only cross-file duplicates
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
