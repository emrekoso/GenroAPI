/** A tiny tokenizer for previewing generated TypeScript and Go. It never alters text: the tokens always concatenate to the input. */
export type Language = 'ts' | 'go' | 'text';
export type TokenKind = 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'function';
export interface Token { text: string; kind?: TokenKind }

export function languageOf(path: string): Language {
  if (/\.(ts|tsx)$/.test(path)) return 'ts';
  if (path.endsWith('.go')) return 'go';
  return 'text';
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const KEYWORDS: Record<Exclude<Language, 'text'>, Set<string>> = {
  ts: words(`abstract as async await break case catch class const continue declare default delete do else enum export extends false
    finally for from function if implements import in instanceof interface keyof let namespace new null of private protected public
    readonly return satisfies static super switch this throw true try type typeof undefined var while yield`),
  go: words(`break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package
    range return select struct switch true type var`),
};
const TYPES: Record<Exclude<Language, 'text'>, Set<string>> = {
  ts: words('any bigint boolean never number object string symbol unknown void'),
  go: words('any bool byte complex128 complex64 error float32 float64 int int16 int32 int64 int8 rune string uint uint16 uint32 uint64 uint8 uintptr'),
};

// 1 comment, 2 string (an unterminated one runs to the end of its line), 3 number, 4 identifier.
const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export function highlight(code: string, lang: Language): Token[] {
  if (lang === 'text' || code === '') return [{ text: code }];
  const out: Token[] = [];
  let last = 0;
  const push = (text: string, kind?: TokenKind) => { if (text !== '') out.push(kind ? { text, kind } : { text }); };
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(code); m; m = TOKEN_RE.exec(code)) {
    if (m[0] === '') { TOKEN_RE.lastIndex++; continue; }
    push(code.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) push(m[0], 'comment');
    else if (m[2] !== undefined) push(m[0], 'string');
    else if (m[3] !== undefined) push(m[0], 'number');
    else {
      const w = m[0];
      if (KEYWORDS[lang].has(w)) push(w, 'keyword');
      else if (TYPES[lang].has(w)) push(w, 'type');
      else if (code[last] === '(') push(w, 'function');
      else if (/^[A-Z]/.test(w)) push(w, 'type');
      else push(w);
    }
  }
  push(code.slice(last));
  return out;
}
