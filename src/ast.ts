import { parseSync } from "oxc-parser";
import type {
  Program,
  Statement,
  Expression,
  FunctionDeclaration,
  VariableDeclaration,
  VariableDeclarator,
  Class,
  ArrowFunctionExpression,
  FunctionExpression,
  BlockStatement,
  ReturnStatement,
  IfStatement,
  ForStatement,
  CallExpression,
  MemberExpression,
  BinaryExpression,
  LogicalExpression,
  UnaryExpression,
  ConditionalExpression,
  AssignmentExpression,
  ObjectExpression,
  ObjectProperty,
  ArrayExpression,
  SpreadElement,
  AwaitExpression,
  ExpressionStatement,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  BindingIdentifier,
} from "@oxc-project/types";

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

type ASTNode = Statement | Expression | VariableDeclarator | ObjectProperty | SpreadElement | null;

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

function normalizeAST(node: ASTNode, idMap: Map<string, string>, counter: { val: number }): string {
  if (!node) return "";
  
  const type = node.type;

  // Identifiers
  if (type === "Identifier") {
    const name = (node as { name: string }).name;
    if (PRESERVED_IDENTIFIERS.has(name)) return name;
    if (!idMap.has(name)) idMap.set(name, `$${counter.val++}`);
    return idMap.get(name)!;
  }

  // Literals
  if (type === "StringLiteral") return '"S"';
  if (type === "NumericLiteral") return "N";
  if (type === "BooleanLiteral") return String((node as { value: boolean }).value);
  if (type === "NullLiteral") return "null";

  // Block
  if (type === "BlockStatement") {
    const block = node as BlockStatement;
    return `{${block.body.map(n => normalizeAST(n, idMap, counter)).join(";")}}`;
  }

  // Functions
  if (type === "FunctionDeclaration" || type === "FunctionExpression") {
    const fn = node as FunctionDeclaration | FunctionExpression;
    const params = fn.params.map(p => normalizeAST(p as ASTNode, idMap, counter)).join(",");
    const body = fn.body ? normalizeAST(fn.body, idMap, counter) : "";
    const async = fn.async ? "async " : "";
    return `${async}function(${params})${body}`;
  }

  if (type === "ArrowFunctionExpression") {
    const arrow = node as ArrowFunctionExpression;
    const params = arrow.params.map(p => normalizeAST(p as ASTNode, idMap, counter)).join(",");
    const body = normalizeAST(arrow.body as ASTNode, idMap, counter);
    const async = arrow.async ? "async " : "";
    return `${async}(${params})=>${body}`;
  }

  // Variables
  if (type === "VariableDeclaration") {
    const decl = node as VariableDeclaration;
    return `${decl.kind} ${decl.declarations.map(d => normalizeAST(d, idMap, counter)).join(",")}`;
  }

  if (type === "VariableDeclarator") {
    const decl = node as VariableDeclarator;
    const id = normalizeAST(decl.id as ASTNode, idMap, counter);
    const init = decl.init ? `=${normalizeAST(decl.init as ASTNode, idMap, counter)}` : "";
    return `${id}${init}`;
  }

  // Statements
  if (type === "ReturnStatement") {
    const ret = node as ReturnStatement;
    return `return ${ret.argument ? normalizeAST(ret.argument as ASTNode, idMap, counter) : ""}`;
  }

  if (type === "IfStatement") {
    const ifStmt = node as IfStatement;
    const test = normalizeAST(ifStmt.test as ASTNode, idMap, counter);
    const consequent = normalizeAST(ifStmt.consequent, idMap, counter);
    const alternate = ifStmt.alternate ? ` else ${normalizeAST(ifStmt.alternate, idMap, counter)}` : "";
    return `if(${test})${consequent}${alternate}`;
  }

  if (type === "ForStatement") {
    const forStmt = node as ForStatement;
    const init = forStmt.init ? normalizeAST(forStmt.init as ASTNode, idMap, counter) : "";
    const test = forStmt.test ? normalizeAST(forStmt.test as ASTNode, idMap, counter) : "";
    const update = forStmt.update ? normalizeAST(forStmt.update as ASTNode, idMap, counter) : "";
    const body = normalizeAST(forStmt.body, idMap, counter);
    return `for(${init};${test};${update})${body}`;
  }

  if (type === "ExpressionStatement") {
    const exprStmt = node as ExpressionStatement;
    return normalizeAST(exprStmt.expression as ASTNode, idMap, counter);
  }

  // Expressions
  if (type === "CallExpression") {
    const call = node as CallExpression;
    const callee = normalizeAST(call.callee as ASTNode, idMap, counter);
    const args = call.arguments.map(a => normalizeAST(a as ASTNode, idMap, counter)).join(",");
    return `${callee}(${args})`;
  }

  if (type === "MemberExpression") {
    const member = node as MemberExpression;
    const obj = normalizeAST(member.object as ASTNode, idMap, counter);
    const prop = member.computed 
      ? `[${normalizeAST(member.property as ASTNode, idMap, counter)}]`
      : `.${normalizeAST(member.property as ASTNode, idMap, counter)}`;
    return obj + prop;
  }

  if (type === "BinaryExpression" || type === "LogicalExpression") {
    const bin = node as BinaryExpression | LogicalExpression;
    return `(${normalizeAST(bin.left as ASTNode, idMap, counter)}${bin.operator}${normalizeAST(bin.right as ASTNode, idMap, counter)})`;
  }

  if (type === "UnaryExpression") {
    const unary = node as UnaryExpression;
    return `${unary.operator}${normalizeAST(unary.argument as ASTNode, idMap, counter)}`;
  }

  if (type === "ConditionalExpression") {
    const cond = node as ConditionalExpression;
    return `(${normalizeAST(cond.test as ASTNode, idMap, counter)}?${normalizeAST(cond.consequent as ASTNode, idMap, counter)}:${normalizeAST(cond.alternate as ASTNode, idMap, counter)})`;
  }

  if (type === "AssignmentExpression") {
    const assign = node as AssignmentExpression;
    return `${normalizeAST(assign.left as ASTNode, idMap, counter)}${assign.operator}${normalizeAST(assign.right as ASTNode, idMap, counter)}`;
  }

  if (type === "ObjectExpression") {
    const obj = node as ObjectExpression;
    const props = obj.properties.map(p => normalizeAST(p as ASTNode, idMap, counter)).join(",");
    return `{${props}}`;
  }

  if (type === "Property") {
    const prop = node as ObjectProperty;
    const key = normalizeAST(prop.key as ASTNode, idMap, counter);
    const value = normalizeAST(prop.value as ASTNode, idMap, counter);
    return prop.shorthand ? key : `${key}:${value}`;
  }

  if (type === "ArrayExpression") {
    const arr = node as ArrayExpression;
    return `[${arr.elements.map(e => normalizeAST(e as ASTNode, idMap, counter)).join(",")}]`;
  }

  if (type === "SpreadElement") {
    const spread = node as SpreadElement;
    return `...${normalizeAST(spread.argument as ASTNode, idMap, counter)}`;
  }

  if (type === "AwaitExpression") {
    const awaitExpr = node as AwaitExpression;
    return `await ${normalizeAST(awaitExpr.argument as ASTNode, idMap, counter)}`;
  }

  // TypeScript - skip type annotations for normalization
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
      const isExported = node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration";
      const actualNode = isExported 
        ? (node as ExportNamedDeclaration | ExportDefaultDeclaration).declaration 
        : node;
      
      if (!actualNode) continue;

      // Function declarations
      if (actualNode.type === "FunctionDeclaration") {
        const fn = actualNode as FunctionDeclaration;
        if (!fn.id) continue;
        
        const idMap = new Map<string, string>();
        const counter = { val: 0 };
        const normalized = normalizeAST(fn, idMap, counter);
        
        blocks.push({
          type: "function",
          name: fn.id.name,
          content: content.slice(fn.start, fn.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: getLineNumber(content, fn.start),
          endLine: getLineNumber(content, fn.end),
          exported: isExported,
        });
      }

      // Arrow functions and function expressions in variable declarations
      if (actualNode.type === "VariableDeclaration") {
        const varDecl = actualNode as VariableDeclaration;
        for (const decl of varDecl.declarations) {
          const id = decl.id as BindingIdentifier;
          if (!id.name || !decl.init) continue;
          if (decl.init.type !== "ArrowFunctionExpression" && decl.init.type !== "FunctionExpression") continue;
          
          const idMap = new Map<string, string>();
          const counter = { val: 0 };
          const normalized = normalizeAST(decl.init as ASTNode, idMap, counter);
          
          blocks.push({
            type: "arrow",
            name: id.name,
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
        const iface = actualNode as TSInterfaceDeclaration;
        const nodeContent = content.slice(iface.start, iface.end);
        blocks.push({
          type: "interface",
          name: iface.id.name,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: getLineNumber(content, iface.start),
          endLine: getLineNumber(content, iface.end),
          exported: isExported,
        });
      }

      // TypeScript type aliases
      if (actualNode.type === "TSTypeAliasDeclaration") {
        const typeAlias = actualNode as TSTypeAliasDeclaration;
        const nodeContent = content.slice(typeAlias.start, typeAlias.end);
        blocks.push({
          type: "type",
          name: typeAlias.id.name,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: getLineNumber(content, typeAlias.start),
          endLine: getLineNumber(content, typeAlias.end),
          exported: isExported,
        });
      }

      // Classes
      if (actualNode.type === "ClassDeclaration") {
        const cls = actualNode as Class;
        if (!cls.id) continue;
        
        const normalized = `class{}`;
        
        blocks.push({
          type: "class",
          name: cls.id.name,
          content: content.slice(cls.start, cls.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: getLineNumber(content, cls.start),
          endLine: getLineNumber(content, cls.end),
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
