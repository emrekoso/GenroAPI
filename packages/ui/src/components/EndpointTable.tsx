import { useMemo, useState } from 'react';
import { groupNames } from '../groups';
import type { Endpoint, GoMode } from '@genroapi/core';
// Deep import: the package root pulls in Node-only parser code that must not be bundled into the UI.
import { RESERVED_WORDS } from '@genroapi/core/src/reserved';

export const GO_MODES: GoMode[] = ['proxy', 'unsecure', 'cache', 'stream', 'passthrough', 'none'];

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set(RESERVED_WORDS);

/** Why an endpoint name cannot be used (it becomes a TS function name and a Go route), or null. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'Name is required';
  if (!IDENT_RE.test(name)) return 'Must be a valid identifier: letters, digits, _ and $, not starting with a digit';
  if (RESERVED.has(name)) return 'Reserved word: pick another name';
  return null;
}

/** Per-endpoint name errors (only enabled endpoints are checked). Names must be unique across ALL groups: Go routes are global. */
export function nameErrors(endpoints: Endpoint[]): Record<string, string> {
  const errs: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const e of endpoints) {
    if (!e.enabled) continue;
    const problem = nameProblem(e.name);
    if (problem) { errs[e.id] = problem; continue; }
    if (seen.has(e.name)) { errs[e.id] = 'Duplicate name (routes are global)'; errs[seen.get(e.name)!] = 'Duplicate name (routes are global)'; }
    else seen.set(e.name, e.id);
  }
  return errs;
}

interface Props {
  endpoints: Endpoint[]; showGo: boolean; errors: Record<string, string>; groupErrors: Record<string, string>;
  onChange(id: string, patch: Partial<Endpoint>): void;
  onEnableAll(ids: string[], enabled: boolean): void;
  onGroupAll(ids: string[], group: string): void;
}

export function EndpointTable({ endpoints, showGo, errors, groupErrors, onChange, onEnableAll, onGroupAll }: Props) {
  const [filter, setFilter] = useState('');
  const [bulkGroup, setBulkGroup] = useState('');
  const groups = useMemo(() => groupNames(endpoints), [endpoints]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? endpoints.filter(e => [e.name, e.path, e.group].some(s => s.toLowerCase().includes(q))) : endpoints;
  }, [endpoints, filter]);
  const ids = shown.map(e => e.id);
  const applyGroup = () => { onGroupAll(ids, bulkGroup); setBulkGroup(''); };

  return (
    <section className="card">
      <div className="row">
        <h2>Endpoints <small>({endpoints.filter(e => e.enabled).length}/{endpoints.length} enabled)</small></h2>
        <label className="field grow"><span className="sr-only">Filter endpoints</span>
          <input type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name, path or group" aria-label="Filter endpoints" />
        </label>
        <button type="button" onClick={() => onEnableAll(ids, true)}>Select all</button>
        <button type="button" onClick={() => onEnableAll(ids, false)}>Select none</button>
      </div>
      <div className="row bulk">
        <label className="field grow"><span className="sr-only">Move shown endpoints to group</span>
          <input list="group-options" value={bulkGroup} onChange={e => setBulkGroup(e.target.value)} aria-label="Move shown endpoints to group"
            placeholder={`Move the ${shown.length} shown endpoint${shown.length === 1 ? '' : 's'} to a group (new or existing)…`} />
        </label>
        <button type="button" disabled={bulkGroup.trim() === '' || ids.length === 0} onClick={applyGroup}>Apply group</button>
      </div>
      <datalist id="group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">On</th><th scope="col">Name</th><th scope="col">Group</th><th scope="col">Endpoint</th>
              {showGo && <th scope="col">Go mode</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(e => {
              const key = `${e.method.toUpperCase()} ${e.path}`;
              const err = errors[e.id];
              return (
                <tr key={e.id} className={e.enabled ? '' : 'off'}>
                  <td><input type="checkbox" checked={e.enabled} aria-label={`Enable ${key}`} onChange={ev => onChange(e.id, { enabled: ev.target.checked })} /></td>
                  <td>
                    <input value={e.name} aria-label={`Name of ${key}`} aria-invalid={!!err} onChange={ev => onChange(e.id, { name: ev.target.value })} />
                    {err && <div className="err" role="note">{err}</div>}
                  </td>
                  <td>
                    <input list="group-options" value={e.group} aria-label={`Group of ${key}`} aria-invalid={!!groupErrors[e.id]} onChange={ev => onChange(e.id, { group: ev.target.value })} />
                    {groupErrors[e.id] && <div className="err" role="note">{groupErrors[e.id]}</div>}
                  </td>
                  <td><span className={`method m-${e.method}`}>{e.method.toUpperCase()}</span> <code>{e.path}</code></td>
                  {showGo && (
                    <td className="gomode">
                      <select value={e.goMode} aria-label={`Go mode of ${key}`} onChange={ev => onChange(e.id, { goMode: ev.target.value as GoMode })}>
                        {GO_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      {e.goMode === 'cache' && (
                        <input className="ttl" value={e.cacheTtl ?? ''} placeholder="5m  (or a Go expression)" aria-label={`Cache TTL of ${key}`} onChange={ev => onChange(e.id, { cacheTtl: ev.target.value })} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
