interface Props {
  url: string; prefix: string; loading: boolean; prefixRequired: boolean;
  onUrl(v: string): void; onPrefix(v: string): void; onLoad(): void;
}

/** Why the prefix cannot be used, or null. Required only for the Go backend (it is just the Go upstream path). */
export function prefixProblem(p: string, required: boolean): string | null {
  if (/\s/.test(p.trim())) return 'The prefix must not contain spaces.';
  if (required && !/[^/\s]/.test(p)) return 'The prefix is required for the Go backend.';
  return null;
}
export const prefixValid = (p: string, required: boolean): boolean => prefixProblem(p, required) === null;

export function SpecForm({ url, prefix, loading, prefixRequired, onUrl, onPrefix, onLoad }: Props) {
  const problem = prefixProblem(prefix, prefixRequired);
  const ok = url.trim() !== '' && problem === null;
  return (
    <form className="card spec-form" onSubmit={e => { e.preventDefault(); if (ok && !loading) onLoad(); }}>
      <label className="field grow">
        <span>Swagger URL</span>
        <input value={url} onChange={e => onUrl(e.target.value)} placeholder="http://host/openapi.json or .yaml" />
      </label>
      <label className="field">
        <span>Service prefix</span>
        <input value={prefix} onChange={e => onPrefix(e.target.value)} placeholder="/periodic" aria-describedby="prefix-help" aria-invalid={problem !== null && prefix.trim() !== ''} />
      </label>
      <button type="submit" className="primary" disabled={!ok || loading}>{loading ? 'Loading…' : 'Load'}</button>
      <p id="prefix-help" className="help">
        The URL must be the spec document itself (JSON or YAML), not the Swagger UI page.
        The prefix is only used for the Go upstream path (required for Go, optional otherwise); a prefix already present in the spec paths is stripped first.
      </p>
      {problem && prefix.trim() !== '' && <p className="err" role="note">{problem}</p>}
    </form>
  );
}
