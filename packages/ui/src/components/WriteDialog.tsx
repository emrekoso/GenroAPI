import { useEffect, useRef, useState } from 'react';
import type { GeneratedFile } from '@genroapi/core';
import { diff, write, type DiffEntry, type OutDirs, type WriteResult } from '../api';

interface Props {
  files: GeneratedFile[]; outDirs: OutDirs; goPackage: string;
  onClose(): void; onError(msg: string): void;
}

/** Router names come from the generated Go source, never recomputed here. */
export function routerNames(files: GeneratedFile[]): string[] {
  const out: string[] = [];
  for (const f of files) if (f.kind === 'backend') for (const m of f.content.matchAll(/func\s+(\w+)Router\(/g)) out.push(m[1]);
  return out;
}

export function WriteDialog({ files, outDirs, goPackage, onClose, onError }: Props) {
  const [entries, setEntries] = useState<DiffEntry[] | null>(null);
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<WriteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    diff(files, outDirs).then(r => alive && setEntries(r)).catch(e => { if (alive) { onError(e.message); onClose(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { ref.current?.focus(); }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const confirm = async () => {
    setBusy(true);
    try { setResult(await write(files, outDirs, [...overwrite])); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const toggle = (p: string, on: boolean) => setOverwrite(s => { const n = new Set(s); on ? n.add(p) : n.delete(p); return n; });
  const routers = routerNames(files);

  return (
    <div className="backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="wd-title" tabIndex={-1} className="dialog" onKeyDown={onKeyDown}>
        <h2 id="wd-title">Write files</h2>
        {!entries && <p>Checking existing files…</p>}
        {entries && !result && (
          <ul className="files">
            {entries.map(en => (
              <li key={en.path}>
                <div className="row">
                  <code>{en.path}</code>
                  <span className={`badge b-${en.status}`}>{en.status}</span>
                  {en.status === 'changed' && (
                    <label className="check"><input type="checkbox" checked={overwrite.has(en.path)} onChange={e => toggle(en.path, e.target.checked)} aria-label={`Overwrite ${en.path}`} /> Overwrite</label>
                  )}
                </div>
                {en.status === 'changed' && en.diff && <pre className="diff">{en.diff}</pre>}
              </li>
            ))}
          </ul>
        )}
        {result && (
          <div>
            <p><strong>Written:</strong> {result.written.length ? result.written.join(', ') : 'none'}</p>
            <p><strong>Skipped:</strong> {result.skipped.length ? result.skipped.join(', ') : 'none'}</p>
          </div>
        )}
        {routers.length > 0 && (
          <div className="routers">
            <p className="help">Register in your app's main router:</p>
            {routers.map(r => <pre key={r}><code>{`${goPackage}.${r}Router(router)`}</code></pre>)}
          </div>
        )}
        <div className="row end">
          {!result && <button type="button" className="primary" disabled={!entries || busy} onClick={confirm}>Confirm</button>}
          <button type="button" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
}
