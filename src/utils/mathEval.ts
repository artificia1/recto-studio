/**
 * Safe arithmetic expression evaluator for print dimension inputs.
 * Supports: +, -, *, /, parenthesis, relative offsets (+10, -5, *2, /2),
 * and units (mm, cm, in, pt, px).
 * Zero eval() or Function() usage.
 */

export function evaluateMathExpression(expr: string | number, currentValue: number = 0): number | null {
  if (typeof expr === 'number') {
    return isNaN(expr) || !isFinite(expr) ? null : expr;
  }
  if (!expr || typeof expr !== 'string') return null;

  let clean = expr.trim().toLowerCase();
  if (clean === '') return null;

  // Relative prefix shorthand (e.g. "+10", "-5", "*2", "/3")
  if (/^[+\-*/]/.test(clean)) {
    clean = `${currentValue} ${clean}`;
  }

  // Convert print and digital units to mm:
  // 1 in = 25.4 mm
  // 1 cm = 10 mm
  // 1 pt = 25.4 / 72 mm (~0.352778 mm)
  // 1 px = 25.4 / 96 mm (~0.264583 mm)
  clean = clean.replace(/([\d.]+)\s*in(?:ch(?:es)?)?\b/g, (_, n) => String(parseFloat(n) * 25.4));
  clean = clean.replace(/([\d.]+)\s*cm\b/g, (_, n) => String(parseFloat(n) * 10));
  clean = clean.replace(/([\d.]+)\s*pt\b/g, (_, n) => String(parseFloat(n) * (25.4 / 72)));
  clean = clean.replace(/([\d.]+)\s*px\b/g, (_, n) => String(parseFloat(n) * (25.4 / 96)));
  clean = clean.replace(/([\d.]+)\s*mm\b/g, '$1');

  // Verify only allowed characters remain: numbers, whitespace, +, -, *, /, ., (, )
  if (!/^[\d\s.+\-*/()]+$/.test(clean)) {
    return null;
  }

  try {
    const tokens = tokenize(clean);
    if (!tokens || tokens.length === 0) return null;
    const parser = new ArithmeticParser(tokens);
    const result = parser.parse();
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return Math.round(result * 100) / 100;
    }
  } catch {
    return null;
  }

  return null;
}

type TokenType = 'NUMBER' | 'PLUS' | 'MINUS' | 'MUL' | 'DIV' | 'LPAREN' | 'RPAREN';

interface Token {
  type: TokenType;
  value?: number;
}

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '+') {
      tokens.push({ type: 'PLUS' });
      i++;
    } else if (char === '-') {
      tokens.push({ type: 'MINUS' });
      i++;
    } else if (char === '*' || char === 'x') {
      tokens.push({ type: 'MUL' });
      i++;
    } else if (char === '/') {
      tokens.push({ type: 'DIV' });
      i++;
    } else if (char === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
    } else if (char === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
    } else if (/[\d.]/.test(char)) {
      let numStr = '';
      let hasDot = false;
      while (i < input.length && /[\d.]/.test(input[i])) {
        if (input[i] === '.') {
          if (hasDot) break;
          hasDot = true;
        }
        numStr += input[i];
        i++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) return null;
      tokens.push({ type: 'NUMBER', value: num });
    } else {
      return null;
    }
  }
  return tokens;
}

class ArithmeticParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parse(): number {
    const val = this.expr();
    if (this.pos < this.tokens.length) {
      throw new Error('Unexpected extra tokens');
    }
    return val;
  }

  // expr = term (('+' | '-') term)*
  private expr(): number {
    let result = this.term();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.type === 'PLUS') {
        this.pos++;
        result += this.term();
      } else if (token.type === 'MINUS') {
        this.pos++;
        result -= this.term();
      } else {
        break;
      }
    }
    return result;
  }

  // term = factor (('*' | '/') factor)*
  private term(): number {
    let result = this.factor();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.type === 'MUL') {
        this.pos++;
        result *= this.factor();
      } else if (token.type === 'DIV') {
        this.pos++;
        const denominator = this.factor();
        if (denominator === 0) throw new Error('Division by zero');
        result /= denominator;
      } else {
        break;
      }
    }
    return result;
  }

  // factor = ('+' | '-')? (NUMBER | '(' expr ')')
  private factor(): number {
    if (this.pos >= this.tokens.length) {
      throw new Error('Unexpected end of expression');
    }

    let sign = 1;
    if (this.tokens[this.pos].type === 'PLUS') {
      this.pos++;
    } else if (this.tokens[this.pos].type === 'MINUS') {
      sign = -1;
      this.pos++;
    }

    if (this.pos >= this.tokens.length) {
      throw new Error('Unexpected end of expression after unary operator');
    }

    const token = this.tokens[this.pos];
    if (token.type === 'NUMBER') {
      this.pos++;
      return sign * (token.value ?? 0);
    }

    if (token.type === 'LPAREN') {
      this.pos++;
      const val = this.expr();
      if (this.pos >= this.tokens.length || this.tokens[this.pos].type !== 'RPAREN') {
        throw new Error('Missing closing parenthesis');
      }
      this.pos++;
      return sign * val;
    }

    throw new Error(`Unexpected token: ${token.type}`);
  }
}
