import type { GenOptions } from '@genroapi/core';
import type { OutDirs } from '../api';
import { resolveOutDir } from '../resolvePath';

interface Props {
  options: GenOptions; outDirs: OutDirs;
  /** Working directory the server resolves relative output dirs against (unknown until the server reports it). */
  cwd?: string;
  onOptions(o: GenOptions): void; onOutDirs(d: OutDirs): void;
}

const GO_PACKAGE_RE = /^[a-z_][a-z0-9_]*$/;

/** Problems with the Go settings (only relevant for the Go backend). */
export function goOptionProblems(options: GenOptions): { package?: string; teaImport?: string } {
  if (options.backend !== 'go') return {};
  const out: { package?: string; teaImport?: string } = {};
  if (!GO_PACKAGE_RE.test(options.go.package)) out.package = 'Must be a valid Go package name (lowercase letters, digits, _).';
  if (options.go.teaImport.trim() === '' || /["'`\\\r\n]/.test(options.go.teaImport)) out.teaImport = 'Import path is required and must not contain quotes or backslashes.';
  return out;
}

export function OptionsPanel({ options, outDirs, cwd, onOptions, onOutDirs }: Props) {
  const go = options.backend === 'go';
  const problems = goOptionProblems(options);
  const check = (k: 'query' | 'zod' | 'zustand', label: string) => (
    <label className="check"><input type="checkbox" checked={options[k]} onChange={e => onOptions({ ...options, [k]: e.target.checked })} /> {label}</label>
  );
  return (
    <section className="card">
      <h2>Options</h2>
      <div className="row wrap">
        {check('query', 'Query hooks (TanStack Query)')}
        {check('zod', 'Zod')}
        {check('zustand', 'Zustand')}
        <label className="field"><span>Backend</span>
          <select value={options.backend} onChange={e => onOptions({ ...options, backend: e.target.value as GenOptions['backend'] })}>
            <option value="none">None</option>
            <option value="go">Go</option>
          </select>
        </label>
      </div>
      <p className="help">{'Calls use `/<name>` routes served by your Go proxy; endpoints with Go mode `none`, or backend `None`, call the raw spec path on the same origin.'}</p>
      <div className="row wrap">
        {go && <>
          <label className="field"><span>Go package name</span>
            <input value={options.go.package} aria-invalid={!!problems.package} onChange={e => onOptions({ ...options, go: { ...options.go, package: e.target.value } })} />
            </label>
          {problems.package && <span className="err" role="note">{problems.package}</span>}
          <label className="field grow"><span>Tea import path</span>
            <input value={options.go.teaImport} aria-invalid={!!problems.teaImport} onChange={e => onOptions({ ...options, go: { ...options.go, teaImport: e.target.value } })} />
            </label>
          {problems.teaImport && <span className="err" role="note">{problems.teaImport}</span>}
        </>}
      </div>
      <div className="row wrap">
        <DirField id="out-frontend" label="Frontend output dir" value={outDirs.frontend} cwd={cwd} placeholder="web/src/api"
          onChange={v => onOutDirs({ ...outDirs, frontend: v })} />
        {go && <DirField id="out-backend" label="Backend output dir" value={outDirs.backend ?? ''} cwd={cwd} placeholder="server/routers"
          onChange={v => onOutDirs({ ...outDirs, backend: v })} />}
      </div>
    </section>
  );
}

/** An output dir input with a hint showing the absolute folder the files will be written to. */
function DirField({ id, label, value, cwd, placeholder, onChange }: {
  id: string; label: string; value: string; cwd?: string; placeholder: string; onChange(v: string): void;
}) {
  const resolved = cwd ? resolveOutDir(cwd, value) : undefined;
  return (
    <div className="grow">
      <label className="field"><span>{label}</span>
        <input id={id} value={value} required onChange={e => onChange(e.target.value)} placeholder={placeholder}
          aria-describedby={resolved ? `${id}-hint` : undefined} /></label>
      {resolved && <p id={`${id}-hint`} className="hint">
        <span aria-hidden="true">→ </span><code>{resolved.path}</code>
        {resolved.warning && <span className="err" role="note"> {resolved.warning}</span>}
      </p>}
    </div>
  );
}
