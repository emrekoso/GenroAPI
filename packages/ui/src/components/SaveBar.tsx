import type { OutDirs } from '../api';
import { resolveOutDir } from '../resolvePath';

interface Props {
  go: boolean; outDirs: OutDirs; cwd?: string; canWrite: boolean; fileCount: number;
  onOutDirs(d: OutDirs): void; onWrite(): void;
}

export function SaveBar({ go, outDirs, cwd, canWrite, fileCount, onOutDirs, onWrite }: Props) {
  return (
    <div className={`write${go ? '' : ' one'}`}>
      <DirField id="out-frontend" label="Frontend output dir" title="Folder for the TypeScript files" value={outDirs.frontend} cwd={cwd} placeholder="web/src/api"
        onChange={v => onOutDirs({ ...outDirs, frontend: v })} />
      {go && <DirField id="out-backend" label="Backend output dir" title="Folder for the Go file" value={outDirs.backend ?? ''} cwd={cwd} placeholder="server/routers"
        onChange={v => onOutDirs({ ...outDirs, backend: v })} />}
      <div className="save-cta">
        <button type="button" className="btn cta" disabled={!canWrite} onClick={onWrite}>Write…</button>
        <span className="hint">{fileCount} {fileCount === 1 ? 'file' : 'files'} ready</span>
      </div>
    </div>
  );
}

/** An output dir input with a hint showing the absolute folder the files will be written to. */
function DirField({ id, label, title, value, cwd, placeholder, onChange }: {
  id: string; label: string; title: string; value: string; cwd?: string; placeholder: string; onChange(v: string): void;
}) {
  const resolved = cwd ? resolveOutDir(cwd, value) : undefined;
  return (
    <div>
      <label className="field"><span>{title}</span>
        <input id={id} aria-label={label} value={value} required onChange={e => onChange(e.target.value)} placeholder={placeholder}
          aria-describedby={resolved ? `${id}-hint` : undefined} /></label>
      {resolved && <p id={`${id}-hint`} className="hint">
        <span aria-hidden="true">→ </span><code>{resolved.path}</code>
        {resolved.warning && <span className="err" role="note"> {resolved.warning}</span>}
      </p>}
    </div>
  );
}
