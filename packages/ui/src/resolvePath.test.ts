import { describe, it, expect } from 'vitest';
import { resolveOutDir } from './resolvePath';

describe('resolveOutDir', () => {
  const cwd = '/Users/me/project';
  it('joins a relative dir onto the working directory', () => {
    expect(resolveOutDir(cwd, 'src/api')).toEqual({ path: '/Users/me/project/src/api' });
  });
  it('keeps an absolute dir as is', () => {
    expect(resolveOutDir(cwd, '/tmp/out')).toEqual({ path: '/tmp/out' });
  });
  it('normalises ./, .. and repeated slashes like path.resolve', () => {
    expect(resolveOutDir(cwd, './src//api/../gen/')).toEqual({ path: '/Users/me/project/src/gen' });
    expect(resolveOutDir(cwd, '../other')).toEqual({ path: '/Users/me/other' });
  });
  it('never climbs above the root', () => {
    expect(resolveOutDir('/a', '../../../x')).toEqual({ path: '/x' });
  });
  it('trims whitespace and returns nothing for an empty value', () => {
    expect(resolveOutDir(cwd, '  src/api  ')).toEqual({ path: '/Users/me/project/src/api' });
    expect(resolveOutDir(cwd, '   ')).toBeUndefined();
  });
  it('does not expand ~ (the server does not either) and says so', () => {
    expect(resolveOutDir(cwd, '~/out')).toEqual({
      path: '/Users/me/project/~/out',
      warning: "'~' is not expanded. Use an absolute path such as /Users/you/out.",
    });
  });
  it('supports Windows working directories', () => {
    expect(resolveOutDir('C:\\work\\proj', 'src\\api')).toEqual({ path: 'C:\\work\\proj\\src\\api' });
    expect(resolveOutDir('C:\\work\\proj', 'D:\\out')).toEqual({ path: 'D:\\out' });
    expect(resolveOutDir('C:\\work\\proj', '..\\other')).toEqual({ path: 'C:\\work\\other' });
  });
});
