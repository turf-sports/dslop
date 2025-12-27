import { parse } from "@babel/parser";
import _traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

const traverse = (_traverse as unknown as { default: typeof _traverse }).default || _traverse;

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

function normalizeNode(node: t.Node, idMap: Map<string, string>, counter: { val: number }): string {
  if (t.isIdentifier(node)) {
    const name = node.name;
    // Preserve built-ins and common globals
    const preserved = new Set([
      "undefined", "null", "true", "false", "NaN", "Infinity",
      "console", "Math", "Date", "Array", "Object", "String", "Number", "Boolean",
      "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt",
      "JSON", "Error", "TypeError", "RangeError", "parseInt", "parseFloat",
      "setTimeout", "setInterval", "clearTimeout", "clearInterval",
      "require", "module", "exports", "process", "Buffer",
      "React", "useState", "useEffect", "useCallback", "useMemo", "useRef",
    ]);
    if (preserved.has(name)) return name;
    if (!idMap.has(name)) {
      idMap.set(name, `$${counter.val++}`);
    }
    return idMap.get(name) ?? name;
  }

  if (t.isStringLiteral(node)) return '"S"';
  if (t.isNumericLiteral(node)) return "N";
  if (t.isTemplateLiteral(node)) return '`T`';
  if (t.isBooleanLiteral(node)) return String(node.value);
  if (t.isNullLiteral(node)) return "null";

  if (t.isFile(node)) return normalizeNode(node.program, idMap, counter);
  if (t.isProgram(node)) return node.body.map(n => normalizeNode(n, idMap, counter)).join(";");

  if (t.isBlockStatement(node)) {
    return `{${node.body.map(n => normalizeNode(n, idMap, counter)).join(";")}}`;
  }

  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
    const params = node.params.map(p => normalizeNode(p, idMap, counter)).join(",");
    const body = node.body ? normalizeNode(node.body, idMap, counter) : "";
    const async = node.async ? "async " : "";
    return `${async}function(${params})${body}`;
  }

  if (t.isArrowFunctionExpression(node)) {
    const params = node.params.map(p => normalizeNode(p, idMap, counter)).join(",");
    const body = normalizeNode(node.body, idMap, counter);
    const async = node.async ? "async " : "";
    return `${async}(${params})=>${body}`;
  }

  if (t.isVariableDeclaration(node)) {
    return `${node.kind} ${node.declarations.map(d => normalizeNode(d, idMap, counter)).join(",")}`;
  }

  if (t.isVariableDeclarator(node)) {
    const id = normalizeNode(node.id, idMap, counter);
    const init = node.init ? `=${normalizeNode(node.init, idMap, counter)}` : "";
    return `${id}${init}`;
  }

  if (t.isReturnStatement(node)) {
    return `return ${node.argument ? normalizeNode(node.argument, idMap, counter) : ""}`;
  }

  if (t.isIfStatement(node)) {
    const test = normalizeNode(node.test, idMap, counter);
    const consequent = normalizeNode(node.consequent, idMap, counter);
    const alternate = node.alternate ? ` else ${normalizeNode(node.alternate, idMap, counter)}` : "";
    return `if(${test})${consequent}${alternate}`;
  }

  if (t.isForStatement(node)) {
    const init = node.init ? normalizeNode(node.init, idMap, counter) : "";
    const test = node.test ? normalizeNode(node.test, idMap, counter) : "";
    const update = node.update ? normalizeNode(node.update, idMap, counter) : "";
    const body = normalizeNode(node.body, idMap, counter);
    return `for(${init};${test};${update})${body}`;
  }

  if (t.isForOfStatement(node) || t.isForInStatement(node)) {
    const left = normalizeNode(node.left, idMap, counter);
    const right = normalizeNode(node.right, idMap, counter);
    const body = normalizeNode(node.body, idMap, counter);
    const keyword = t.isForOfStatement(node) ? "of" : "in";
    return `for(${left} ${keyword} ${right})${body}`;
  }

  if (t.isWhileStatement(node)) {
    return `while(${normalizeNode(node.test, idMap, counter)})${normalizeNode(node.body, idMap, counter)}`;
  }

  if (t.isTryStatement(node)) {
    const block = normalizeNode(node.block, idMap, counter);
    const handler = node.handler 
      ? `catch(${node.handler.param ? normalizeNode(node.handler.param, idMap, counter) : ""})${normalizeNode(node.handler.body, idMap, counter)}` 
      : "";
    const finalizer = node.finalizer ? `finally${normalizeNode(node.finalizer, idMap, counter)}` : "";
    return `try${block}${handler}${finalizer}`;
  }

  if (t.isThrowStatement(node)) {
    return `throw ${normalizeNode(node.argument, idMap, counter)}`;
  }

  if (t.isExpressionStatement(node)) {
    return normalizeNode(node.expression, idMap, counter);
  }

  if (t.isCallExpression(node)) {
    const callee = normalizeNode(node.callee, idMap, counter);
    const args = node.arguments.map(a => normalizeNode(a, idMap, counter)).join(",");
    return `${callee}(${args})`;
  }

  if (t.isMemberExpression(node)) {
    const obj = normalizeNode(node.object, idMap, counter);
    const prop = node.computed 
      ? `[${normalizeNode(node.property, idMap, counter)}]`
      : `.${normalizeNode(node.property, idMap, counter)}`;
    return obj + prop;
  }

  if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
    return `(${normalizeNode(node.left, idMap, counter)}${node.operator}${normalizeNode(node.right, idMap, counter)})`;
  }

  if (t.isUnaryExpression(node)) {
    return `${node.operator}${normalizeNode(node.argument, idMap, counter)}`;
  }

  if (t.isConditionalExpression(node)) {
    return `(${normalizeNode(node.test, idMap, counter)}?${normalizeNode(node.consequent, idMap, counter)}:${normalizeNode(node.alternate, idMap, counter)})`;
  }

  if (t.isAssignmentExpression(node)) {
    return `${normalizeNode(node.left, idMap, counter)}${node.operator}${normalizeNode(node.right, idMap, counter)}`;
  }

  if (t.isObjectExpression(node)) {
    const props = node.properties.map(p => normalizeNode(p, idMap, counter)).join(",");
    return `{${props}}`;
  }

  if (t.isObjectProperty(node)) {
    const key = normalizeNode(node.key, idMap, counter);
    const value = normalizeNode(node.value, idMap, counter);
    return node.shorthand ? key : `${key}:${value}`;
  }

  if (t.isArrayExpression(node)) {
    return `[${node.elements.map(e => e ? normalizeNode(e, idMap, counter) : "").join(",")}]`;
  }

  if (t.isSpreadElement(node)) {
    return `...${normalizeNode(node.argument, idMap, counter)}`;
  }

  if (t.isAwaitExpression(node)) {
    return `await ${normalizeNode(node.argument, idMap, counter)}`;
  }

  if (t.isNewExpression(node)) {
    const callee = normalizeNode(node.callee, idMap, counter);
    const args = node.arguments.map(a => normalizeNode(a, idMap, counter)).join(",");
    return `new ${callee}(${args})`;
  }

  if (t.isClassDeclaration(node) || t.isClassExpression(node)) {
    const superClass = node.superClass ? ` extends ${normalizeNode(node.superClass, idMap, counter)}` : "";
    const body = normalizeNode(node.body, idMap, counter);
    return `class${superClass}${body}`;
  }

  if (t.isClassBody(node)) {
    return `{${node.body.map(m => normalizeNode(m, idMap, counter)).join(";")}}`;
  }

  if (t.isClassMethod(node)) {
    const key = normalizeNode(node.key, idMap, counter);
    const params = node.params.map(p => normalizeNode(p, idMap, counter)).join(",");
    const body = normalizeNode(node.body, idMap, counter);
    const kind = node.kind !== "method" ? `${node.kind} ` : "";
    const async = node.async ? "async " : "";
    const static_ = node.static ? "static " : "";
    return `${static_}${async}${kind}${key}(${params})${body}`;
  }

  if (t.isObjectMethod(node)) {
    const key = normalizeNode(node.key, idMap, counter);
    const params = node.params.map(p => normalizeNode(p, idMap, counter)).join(",");
    const body = normalizeNode(node.body, idMap, counter);
    return `${key}(${params})${body}`;
  }

  if (t.isRestElement(node)) {
    return `...${normalizeNode(node.argument, idMap, counter)}`;
  }

  if (t.isObjectPattern(node)) {
    return `{${node.properties.map(p => normalizeNode(p, idMap, counter)).join(",")}}`;
  }

  if (t.isArrayPattern(node)) {
    return `[${node.elements.map(e => e ? normalizeNode(e, idMap, counter) : "").join(",")}]`;
  }

  if (t.isAssignmentPattern(node)) {
    return `${normalizeNode(node.left, idMap, counter)}=${normalizeNode(node.right, idMap, counter)}`;
  }

  // TypeScript specific
  if (t.isTSTypeAnnotation(node)) return "";
  if (t.isTSTypeParameterDeclaration(node)) return "";
  if (t.isTSTypeParameterInstantiation(node)) return "";
  if (t.isTSAsExpression(node)) return normalizeNode(node.expression, idMap, counter);
  if (t.isTSNonNullExpression(node)) return normalizeNode(node.expression, idMap, counter);

  // Fallback for unhandled nodes
  return node.type;
}

export function extractASTBlocks(content: string, filePath: string): ASTBlock[] {
  const blocks: ASTBlock[] = [];
  
  try {
    const ast = parse(content, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy"],
      errorRecovery: true,
    });

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        const node = path.node;
        if (!node.id || !node.loc || node.start === null || node.end === null) return;
        
        const idMap = new Map<string, string>();
        const counter = { val: 0 };
        const normalized = normalizeNode(node, idMap, counter);
        
        blocks.push({
          type: "function",
          name: node.id.name,
          content: content.slice(node.start, node.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          exported: t.isExportNamedDeclaration(path.parent) || t.isExportDefaultDeclaration(path.parent),
        });
      },

      VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
        const node = path.node;
        for (const decl of node.declarations) {
          if (!t.isIdentifier(decl.id) || !decl.init || !decl.loc) continue;
          if (decl.start === null || decl.end === null) continue;
          
          // Only extract arrow functions and function expressions
          if (!t.isArrowFunctionExpression(decl.init) && !t.isFunctionExpression(decl.init)) continue;
          
          const idMap = new Map<string, string>();
          const counter = { val: 0 };
          const normalized = normalizeNode(decl.init, idMap, counter);
          
          blocks.push({
            type: "arrow",
            name: decl.id.name,
            content: content.slice(decl.start, decl.end),
            normalized,
            hash: simpleHash(normalized),
            filePath,
            startLine: decl.loc.start.line,
            endLine: decl.loc.end.line,
            exported: t.isExportNamedDeclaration(path.parent),
          });
        }
      },

      ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
        const node = path.node;
        if (!node.id || !node.loc || node.start === null || node.end === null) return;
        
        const idMap = new Map<string, string>();
        const counter = { val: 0 };
        const normalized = normalizeNode(node, idMap, counter);
        
        blocks.push({
          type: "class",
          name: node.id.name,
          content: content.slice(node.start, node.end),
          normalized,
          hash: simpleHash(normalized),
          filePath,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          exported: t.isExportNamedDeclaration(path.parent) || t.isExportDefaultDeclaration(path.parent),
        });
      },

      TSTypeAliasDeclaration(path: NodePath<t.TSTypeAliasDeclaration>) {
        const node = path.node;
        if (!node.loc || node.start === null || node.end === null) return;
        
        const nodeContent = content.slice(node.start, node.end);
        blocks.push({
          type: "type",
          name: node.id.name,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          exported: t.isExportNamedDeclaration(path.parent),
        });
      },

      TSInterfaceDeclaration(path: NodePath<t.TSInterfaceDeclaration>) {
        const node = path.node;
        if (!node.loc || node.start === null || node.end === null) return;
        
        const nodeContent = content.slice(node.start, node.end);
        blocks.push({
          type: "interface",
          name: node.id.name,
          content: nodeContent,
          normalized: nodeContent.replace(/\s+/g, " "),
          hash: simpleHash(nodeContent.replace(/\s+/g, " ")),
          filePath,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line,
          exported: t.isExportNamedDeclaration(path.parent),
        });
      },
    });
  } catch {
    // Parse error - skip this file for AST extraction
  }

  return blocks;
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

    // Filter out matches from the same location
    const uniqueMatches = matches.filter((m, i) => 
      !matches.slice(0, i).some(prev => 
        prev.filePath === m.filePath && 
        Math.abs(prev.startLine - m.startLine) < 3
      )
    );

    if (uniqueMatches.length < 2) continue;

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

  // Sort by impact (more matches = higher priority)
  groups.sort((a, b) => b.matches.length - a.matches.length);

  // Filter out same-file duplicates (only keep cross-file duplicates)
  const crossFileGroups = groups.filter(group => {
    const uniqueFiles = new Set(group.matches.map(m => m.filePath));
    return uniqueFiles.size > 1;
  });

  return crossFileGroups;
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

