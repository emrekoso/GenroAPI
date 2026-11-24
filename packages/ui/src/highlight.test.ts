import { describe, it, expect } from 'vitest';
import { highlight, languageOf } from './highlight';

const join = (code: string, lang: Parameters<typeof highlight>[1]) => highlight(code, lang).map(t => t.text).join('');
const kinds = (code: string, lang: Parameters<typeof highlight>[1]) =>
  highlight(code, lang).filter(t => t.kind).map(t => `${t.kind}:${t.text}`);

describe('languageOf', () => {
  it('maps file names to languages', () => {
    expect(languageOf('pets.service.gen.ts')).toBe('ts');
    expect(languageOf('periodic.gen.go')).toBe('go');
    expect(languageOf('notes.txt')).toBe('text');
  });
});

describe('highlight', () => {
  it('classifies TypeScript keywords, types, strings, numbers and comments', () => {
    const code = '// Code generated\nexport async function getPet(id: string): Promise<Pet> { return axios.get(`/pets/${id}`, { timeout: 30 }); }';
    expect(kinds(code, 'ts')).toEqual([
      'comment:// Code generated',
      'keyword:export', 'keyword:async', 'keyword:function', 'function:getPet',
      'type:string', 'type:Promise', 'type:Pet',
      'keyword:return', 'function:get', 'string:`/pets/${id}`', 'number:30',
    ]);
  });

  it('classifies Go keywords, types and strings', () => {
    const code = 'package routers\n\nfunc PetsRouter(router *tea.Router) {\n\trouter.HandleProxy("/getPet/{id}", "/pets/{id}")\n}';
    expect(kinds(code, 'go')).toEqual([
      'keyword:package', 'keyword:func', 'function:PetsRouter', 'type:Router',
      'function:HandleProxy', 'string:"/getPet/{id}"', 'string:"/pets/{id}"',
    ]);
  });

  it('does not colour words inside strings or comments', () => {
    expect(kinds('const a = "export function"; /* return */', 'ts')).toEqual(['keyword:const', 'string:"export function"', 'comment:/* return */']);
  });

  it('handles escapes and an unterminated string without swallowing the rest', () => {
    expect(kinds('const a = "x\\"y"; const b = 1;', 'ts')).toEqual(['keyword:const', 'string:"x\\"y"', 'keyword:const', 'number:1']);
    expect(kinds('const a = "oops\nconst b = 2;', 'ts')).toEqual(['keyword:const', 'string:"oops', 'keyword:const', 'number:2']);
  });

  it('never changes the text: concatenated tokens equal the input', () => {
    const samples = [
      '', 'plain text', 'a\r\nb\tc', '`unterminated ${x', "'it\\'s'", '/* open', 'x = 1.5e3 + 0xff',
      'export type A = { "weird-key": string; n?: number | null };', 'func (r *R) F() {}\n// done',
      '<script>alert(1)</script>', 'emoji 🙂 and ünïcode',
    ];
    for (const s of samples) { expect(join(s, 'ts')).toBe(s); expect(join(s, 'go')).toBe(s); expect(join(s, 'text')).toBe(s); }
  });

  it('returns a single plain token for unknown languages', () => {
    expect(highlight('export const a = 1', 'text')).toEqual([{ text: 'export const a = 1' }]);
  });

  it('copes with a large file quickly', () => {
    const big = 'export const a = "x"; // c\n'.repeat(20000);
    const t0 = performance.now();
    expect(join(big, 'ts')).toBe(big);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
