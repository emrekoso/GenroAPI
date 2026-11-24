import { describe, it, expect } from 'vitest';
import type { Endpoint } from '@genroapi/core';
import { normalizeGroups, groupErrors, groupNames } from './groups';

const ep = (id: string, group: string, enabled = true) => ({ id, method: 'get', path: `/${id}`, name: id, group, pathParams: [], queryParams: [], isSse: false, goMode: 'proxy', enabled }) as Endpoint;

describe('normalizeGroups', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeGroups([ep('a', '  my   api  ')]).map(e => e.group)).toEqual(['my api']);
  });
  it('merges spellings that differ only in case into the first one seen', () => {
    expect(normalizeGroups([ep('a', 'Pets'), ep('b', 'pets'), ep('c', 'PETS ')]).map(e => e.group)).toEqual(['Pets', 'Pets', 'Pets']);
  });
  it('keeps unrelated groups and does not mutate the input', () => {
    const input = [ep('a', 'x'), ep('b', ' y ')];
    const before = JSON.stringify(input);
    const out = normalizeGroups(input);
    expect(out.map(e => e.group)).toEqual(['x', 'y']);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('groupErrors', () => {
  it('requires a group on every enabled endpoint (disabled ones are ignored)', () => {
    expect(groupErrors([ep('a', ''), ep('b', '   '), ep('c', 'ok'), ep('d', '', false)])).toEqual({ a: 'Group is required', b: 'Group is required' });
  });
});

describe('groupNames', () => {
  it('lists distinct normalised group names, sorted', () => {
    expect(groupNames([ep('a', 'b'), ep('b', 'A '), ep('c', 'a'), ep('d', '')])).toEqual(['A', 'b']);
  });
});
