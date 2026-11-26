import type { GenOptions } from '@genroapi/core';

interface Props { options: GenOptions; onOptions(o: GenOptions): void }

const GO_PACKAGE_RE = /^[a-z_][a-z0-9_]*$/;

/** Problems with the Go settings (only relevant for the Go backend). */
export function goOptionProblems(options: GenOptions): { package?: string; teaImport?: string } {
  if (options.backend !== 'go') return {};
  const out: { package?: string; teaImport?: string } = {};
  if (!GO_PACKAGE_RE.test(options.go.package)) out.package = 'Must be a valid Go package name (lowercase letters, digits, _).';
  if (options.go.teaImport.trim() === '' || /["'`\\\r\n]/.test(options.go.teaImport)) out.teaImport = 'Import path is required and must not contain quotes or backslashes.';
  return out;
}

export function OptionsPanel({ options, onOptions }: Props) {
  const go = options.backend === 'go';
  const problems = goOptionProblems(options);
  const toggle = (k: 'query' | 'zod' | 'zustand', label: string, title: string, desc: string) => (
    <label className="opt">
      <input type="checkbox" aria-label={label} checked={options[k]} onChange={e => onOptions({ ...options, [k]: e.target.checked })} />
      <b>{title} <span className="sw" aria-hidden="true" /></b>
      <span className="d">{desc}</span>
    </label>
  );
  return (
    <div>
      <div className="extras">
        <div className="opt fixed"><b>Core files <span className="sw" aria-hidden="true" /></b><span className="d">Data shapes and functions to call each endpoint, using axios. Always included.</span></div>
        {toggle('query', 'Query hooks', 'Query hooks', 'Ready-made React hooks that load and cache data (TanStack Query).')}
        {toggle('zod', 'Zod', 'Zod checks', 'Verify that the data coming back really has the shape you expect.')}
        {toggle('zustand', 'Zustand', 'Zustand stores', 'One small store per group that holds data, loading and error state.')}
      </div>
      <label className="opt wide">
        <input type="checkbox" aria-label="Also create Go routes" checked={go} onChange={e => onOptions({ ...options, backend: e.target.checked ? 'go' : 'none' })} />
        <span className="grow"><b>Also create Go routes</b><span className="d">Writes the Go file that forwards each call from your app to the real server.</span></span>
        <span className="sw" aria-hidden="true" />
      </label>
      <p className="hint">{'Calls use `/<name>` routes served by your Go proxy; endpoints with Go mode `none`, or backend `None`, call the raw spec path on the same origin.'}</p>
      {go && (
        <div className="gopanel">
          <div className="field">
            <label className="field"><span>Go package name</span>
              <input value={options.go.package} aria-invalid={!!problems.package} onChange={e => onOptions({ ...options, go: { ...options.go, package: e.target.value } })} />
            </label>
            {problems.package && <span className="err" role="note">{problems.package}</span>}
          </div>
          <div className="field">
            <label className="field"><span>Tea import path</span>
              <input value={options.go.teaImport} aria-invalid={!!problems.teaImport} onChange={e => onOptions({ ...options, go: { ...options.go, teaImport: e.target.value } })} />
            </label>
            {problems.teaImport && <span className="err" role="note">{problems.teaImport}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
