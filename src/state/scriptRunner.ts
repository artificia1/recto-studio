import { parse } from 'acorn';
import type * as AST from 'estree';
import type { CanvasElement, ProjectState } from '../types';

export interface ScriptResult {
  updates: { id: string; updates: Partial<CanvasElement> }[];
  messages: string[];
}
type Binding = { value: unknown; mutable: boolean };
class Scope {
  private bindings = new Map<string, Binding>();
  constructor(private parent?: Scope) {}
  define(name: string, value: unknown, mutable: boolean) { this.bindings.set(name, { value, mutable }); }
  get(name: string): Binding {
    const binding = this.bindings.get(name);
    if (binding) return binding;
    if (this.parent) return this.parent.get(name);
    throw new Error(`Unknown name: ${name}`);
  }
  set(name: string, value: unknown) {
    const binding = this.get(name);
    if (!binding.mutable) throw new Error(`Cannot assign to const ${name}`);
    binding.value = value;
    return value;
  }
}

/** A bounded JavaScript subset. Script text is parsed as data, never executed. */
export function evaluateScript(code: string, state: ProjectState): ScriptResult {
  if (code.length > 64000) throw new Error('Script exceeds the 64 KB limit.');
  const program = parse(code, { ecmaVersion: 2022 }) as unknown as AST.Program;
  const result: ScriptResult = { updates: [], messages: [] };
  const snapshot = structuredClone(state);
  const api = Object.freeze({});
  const consoleApi = Object.freeze({});
  const root = new Scope();
  root.define('stateManager', api, false);
  root.define('console', consoleApi, false);
  let budget = 20000;
  function tick() { if (--budget < 0) throw new Error('Script operation limit exceeded. No changes were applied.'); }
  function key(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid property name.');
    const name = String(value);
    if (['constructor', 'prototype', '__proto__'].includes(name)) throw new Error(`Property ${name} is unavailable.`);
    return name;
  }
  function primitive(value: unknown): string | number | boolean | null | undefined {
    if (value !== null && typeof value === 'object') throw new Error('Expected a primitive value.');
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('Unsupported value.');
    return value as string | number | boolean | null | undefined;
  }
  function expression(node: AST.Expression | AST.SpreadElement, scope: Scope): unknown {
    tick();
    switch (node.type) {
      case 'Literal':
        if ('regex' in node || typeof node.value === 'bigint') throw new Error('Regular expressions and BigInt are unavailable.');
        return node.value;
      case 'Identifier': return node.name === 'undefined' ? undefined : scope.get(node.name).value;
      case 'ArrayExpression': return node.elements.map(item => item ? expression(item, scope) : null);
      case 'ObjectExpression': {
        const object: Record<string, unknown> = Object.create(null);
        for (const property of node.properties) {
          if (property.type !== 'Property' || property.kind !== 'init' || property.method) throw new Error('Only plain object properties are supported.');
          const name = property.computed ? key(expression(property.key as AST.Expression, scope))
            : property.key.type === 'Identifier' ? key(property.key.name) : key((property.key as AST.Literal).value);
          object[name] = expression(property.value as AST.Expression, scope);
        }
        return object;
      }
      case 'MemberExpression': {
        const object = expression(node.object as AST.Expression, scope);
        const name = node.computed ? key(expression(node.property as AST.Expression, scope)) : key((node.property as AST.Identifier).name);
        if (object == null || !Object.hasOwn(Object(object), name)) return undefined;
        return (Object(object) as Record<string, unknown>)[name];
      }
      case 'CallExpression': {
        const args = node.arguments.map(argument => expression(argument, scope));
        if (node.callee.type === 'Identifier' && node.callee.name === 'alert') {
          if (result.messages.length >= 100) throw new Error('Too many script messages.');
          result.messages.push(String(primitive(args[0])).slice(0, 2000));
          return undefined;
        }
        if (node.callee.type !== 'MemberExpression') throw new Error('This function is unavailable.');
        const receiver = expression(node.callee.object as AST.Expression, scope);
        const method = node.callee.computed ? key(expression(node.callee.property as AST.Expression, scope)) : key((node.callee.property as AST.Identifier).name);
        if (receiver === api && method === 'getState') return snapshot;
        if (receiver === api && method === 'updateElement') {
          if (typeof args[0] !== 'string' || !args[1] || typeof args[1] !== 'object' || Array.isArray(args[1])) throw new Error('updateElement expects an ID and a plain update object.');
          if (result.updates.length >= 1000) throw new Error('Scripts can update at most 1,000 elements.');
          result.updates.push({ id: args[0], updates: structuredClone(args[1]) });
          return undefined;
        }
        if (receiver === consoleApi && method === 'log') {
          if (result.messages.length >= 100) throw new Error('Too many script messages.');
          result.messages.push(args.map(value => String(primitive(value))).join(' ').slice(0, 2000));
          return undefined;
        }
        if (typeof receiver === 'string') {
          if (method === 'trim') return receiver.trim();
          if (method === 'toUpperCase') return receiver.toUpperCase();
          if (method === 'toLowerCase') return receiver.toLowerCase();
          if (method === 'includes' && typeof args[0] === 'string') return receiver.includes(args[0]);
        }
        throw new Error(`Method ${method} is unavailable in scripts.`);
      }
      case 'BinaryExpression': {
        const left = primitive(expression(node.left as AST.Expression, scope));
        const right = primitive(expression(node.right, scope));
        if (node.operator === '===') return left === right;
        if (node.operator === '!==') return left !== right;
        if (node.operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
          const value = String(left) + String(right);
          if (value.length > 500000) throw new Error('Script string limit exceeded.');
          return value;
        }
        if (typeof left !== 'number' || typeof right !== 'number') throw new Error('This operator requires numbers.');
        switch (node.operator) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/': return left / right;
          case '%': return left % right;
          case '<': return left < right;
          case '>': return left > right;
          case '<=': return left <= right;
          case '>=': return left >= right;
          default: throw new Error(`Unsupported operator ${node.operator}`);
        }
      }
      case 'LogicalExpression': {
        const left = expression(node.left, scope);
        return node.operator === '&&' ? left && expression(node.right, scope)
          : node.operator === '||' ? left || expression(node.right, scope) : left ?? expression(node.right, scope);
      }
      case 'UnaryExpression': {
        const value = expression(node.argument, scope);
        if (node.operator === '!') return !value;
        if (node.operator === '-' && typeof value === 'number') return -value;
        throw new Error('Unsupported unary operator.');
      }
      case 'AssignmentExpression':
        if (node.operator !== '=' || node.left.type !== 'Identifier') throw new Error('Only local variable assignment is allowed. Use updateElement for document changes.');
        return scope.set(node.left.name, expression(node.right, scope));
      case 'UpdateExpression': {
        if (node.argument.type !== 'Identifier') throw new Error('Only local counters can be updated.');
        const previous = scope.get(node.argument.name).value;
        if (typeof previous !== 'number') throw new Error('Counter must be numeric.');
        const next = previous + (node.operator === '++' ? 1 : -1);
        scope.set(node.argument.name, next);
        return node.prefix ? next : previous;
      }
      default: throw new Error(`Unsupported script syntax: ${node.type}`);
    }
  }
  function statement(node: AST.Statement, scope: Scope): void {
    tick();
    switch (node.type) {
      case 'EmptyStatement': return;
      case 'ExpressionStatement': expression(node.expression, scope); return;
      case 'VariableDeclaration':
        for (const declaration of node.declarations) {
          if (declaration.id.type !== 'Identifier') throw new Error('Use simple variable names.');
          scope.define(declaration.id.name, declaration.init ? expression(declaration.init, scope) : undefined, node.kind !== 'const');
        }
        return;
      case 'BlockStatement': {
        const block = new Scope(scope);
        node.body.forEach(item => statement(item, block));
        return;
      }
      case 'IfStatement':
        if (expression(node.test, scope)) statement(node.consequent, scope);
        else if (node.alternate) statement(node.alternate, scope);
        return;
      case 'ForOfStatement': {
        const items = expression(node.right, scope);
        if (!Array.isArray(items) || node.left.type !== 'VariableDeclaration' || node.left.declarations.length !== 1 || node.left.declarations[0].id.type !== 'Identifier') throw new Error('Use for (const item of anArray).');
        for (const item of items) {
          const iteration = new Scope(scope);
          iteration.define(node.left.declarations[0].id.name, item, node.left.kind !== 'const');
          statement(node.body, iteration);
        }
        return;
      }
      default: throw new Error(`Unsupported script syntax: ${node.type}`);
    }
  }
  program.body.forEach(node => {
    if (node.type === 'ImportDeclaration' || node.type.startsWith('Export')) throw new Error('Modules are unavailable in scripts.');
    statement(node as AST.Statement, root);
  });
  return result;
}
