import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { GeneratedFile } from '@genroapi/core';
import { highlight, languageOf } from '../highlight';

interface Props {
  files: GeneratedFile[]; loading: boolean; blocker: string | null; stale: boolean;
  /** Group colour for a file path. */
  colourOf?(path: string): string | undefined;
  /** When set, selects the first file whose path starts with `prefix`. `n` changes on every request so repeats still count. */
  focus?: { prefix: string; n: number } | null;
}

export function PreviewTabs({ files, loading, blocker, stale, colourOf, focus }: Props) {
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!focus) return;
    const i = files.findIndex(f => f.path.startsWith(focus.prefix));
    if (i >= 0) setSel(i);
    // Only a new focus request moves the selection, never a file refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const idx = Math.min(sel, Math.max(files.length - 1, 0));
  const file = files[idx];
  // Rendered as React text nodes inside spans (never as HTML), since the content derives from a third-party spec.
  const tokens = useMemo(() => (file ? highlight(file.content, languageOf(file.path)) : []), [file]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard unavailable */ }
  };
  return (
    <section className="preview" id="preview">
      <h2 className="sr-only">Preview</h2>
      {loading && <p className="help" role="status">Updating…</p>}
      {blocker && <p className="help">{blocker}</p>}
      {stale && files.length > 0 && <p className="help stale" role="status">Preview out of date: these files do not match the current settings{blocker ? '.' : ', refreshing…'}</p>}
      {files.length === 0 && !loading && !blocker && <p className="help">No files generated.</p>}
      {file && <>
        <div className="viewer">
        <div role="tablist" aria-label="Generated files" className="tabs">
          {files.map((f, i) => (
            <button key={f.path} role="tab" type="button" aria-selected={i === idx} className={i === idx ? 'active' : ''} style={colourOf?.(f.path) ? ({ '--vc': colourOf(f.path) } as CSSProperties) : undefined} onClick={() => setSel(i)}>{f.path}</button>
          ))}
        </div>
        <div role="tabpanel" className="panel">
          <button type="button" className="copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <pre><code>{tokens.map((t, i) => (t.kind ? <span key={i} className={`tok-${t.kind}`}>{t.text}</span> : t.text))}</code></pre>
        </div>
        </div>
      </>}
    </section>
  );
}
