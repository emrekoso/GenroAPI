import { useMemo, useState, type CSSProperties } from 'react';
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
  /** Colour of the group each endpoint belongs to (by id). */
  colourOf(id: string): string;
  onChange(id: string, patch: Partial<Endpoint>): void;
  onEnableAll(ids: string[], enabled: boolean): void;
  onGroupAll(ids: string[], group: string): void;
}

export function EndpointTable({ endpoints, showGo, errors, groupErrors, colourOf, onChange, onEnableAll, onGroupAll }: Props) {
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
    <div className="pane">
      <h3>Your API <span>{endpoints.filter(e => e.enabled).length} of {endpoints.length} selected</span></h3>
      <div className="tools">
        <input className="grow" type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name, path or group" aria-label="Filter endpoints" />
        <button type="button" className="btn ghost" onClick={() => onEnableAll(ids, true)}>Select all</button>
        <button type="button" className="btn ghost" onClick={() => onEnableAll(ids, false)}>Select none</button>
      </div>
      <div className="tools">
        <input className="grow" list="group-options" value={bulkGroup} onChange={e => setBulkGroup(e.target.value)} aria-label="Move shown endpoints to group"
          placeholder={`Move the ${shown.length} shown endpoint${shown.length === 1 ? '' : 's'} to a group (new or existing)…`} />
        <button type="button" className="btn ghost" disabled={bulkGroup.trim() === '' || ids.length === 0} onClick={applyGroup}>Apply group</button>
      </div>
      <datalist id="group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
      <div className="rows">
        {shown.length === 0 && <div className="empty">No endpoint matches that filter.</div>}
        {shown.map(e => {
          const key = `${e.method.toUpperCase()} ${e.path}`;
          const err = errors[e.id];
          return (
            <div key={e.id} className={`ep${e.enabled ? '' : ' off'}${showGo ? '' : ' nogo'}`} style={{ '--c': colourOf(e.id) } as CSSProperties}>
              <div className="l1">
                <input type="checkbox" checked={e.enabled} aria-label={`Enable ${key}`} onChange={ev => onChange(e.id, { enabled: ev.target.checked })} />
                <span className={`method m-${e.method}`}>{e.method.toUpperCase()}</span>
                <code className="path" title={e.path}>{e.path}</code>
                {e.isSse && <span className="sse">live stream</span>}
              </div>
              <div className="l2">
                <label className="cell"><span>Function name</span>
                  <input value={e.name} aria-label={`Name of ${key}`} aria-invalid={!!err} onChange={ev => onChange(e.id, { name: ev.target.value })} />
                  {err && <div className="err" role="note">{err}</div>}
                </label>
                <label className="cell"><span>Group</span>
                  <span className="gin"><i aria-hidden="true" />
                    <input list="group-options" value={e.group} aria-label={`Group of ${key}`} aria-invalid={!!groupErrors[e.id]} onChange={ev => onChange(e.id, { group: ev.target.value })} /></span>
                  {groupErrors[e.id] && <div className="err" role="note">{groupErrors[e.id]}</div>}
                </label>
                {showGo && (
                  <div className="cell gomode">
                    <label className="cell"><span>How Go handles it</span>
                      <select value={e.goMode} aria-label={`Go mode of ${key}`} onChange={ev => onChange(e.id, { goMode: ev.target.value as GoMode })}>
                        {GO_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </label>
                    {e.goMode === 'cache' && (
                      <input className="ttl" value={e.cacheTtl ?? ''} placeholder="5m  (or a Go expression)" aria-label={`Cache TTL of ${key}`} onChange={ev => onChange(e.id, { cacheTtl: ev.target.value })} />
                    )}
                  </div>
                )}
              </div>
              <span className="port" data-port={e.id} aria-hidden="true" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
