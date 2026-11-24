import { useState } from 'react';
import type { GeneratedFile } from '@genroapi/core';

interface Props { files: GeneratedFile[]; loading: boolean; blocker: string | null; stale: boolean }

export function PreviewTabs({ files, loading, blocker, stale }: Props) {
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  const idx = Math.min(sel, Math.max(files.length - 1, 0));
  const file = files[idx];
  const copy = async () => {
    try { await navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard unavailable */ }
  };
  return (
    <section className="card">
      <h2>Preview {loading && <small>updating…</small>}</h2>
      {blocker && <p className="help">{blocker}</p>}
      {stale && files.length > 0 && <p className="help stale" role="status">Preview out of date: these files do not match the current settings{blocker ? '.' : ', refreshing…'}</p>}
      {files.length === 0 && !loading && !blocker && <p className="help">No files generated.</p>}
      {file && <>
        <div role="tablist" aria-label="Generated files" className="tabs">
          {files.map((f, i) => (
            <button key={f.path} role="tab" type="button" aria-selected={i === idx} className={i === idx ? 'active' : ''} onClick={() => setSel(i)}>{f.path}</button>
          ))}
        </div>
        <div role="tabpanel" className="panel">
          <button type="button" className="copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <pre>{file.content}</pre>
        </div>
      </>}
    </section>
  );
}
