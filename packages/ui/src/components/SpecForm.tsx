interface Props {
  url: string;
  prefix: string;
  loading: boolean;
  prefixRequired: boolean;
  onUrl(v: string): void;
  onPrefix(v: string): void;
  onLoad(): void;
}

/** Why the prefix cannot be used, or null. Required only for the Go backend (it is just the Go upstream path). */
export function prefixProblem(p: string, required: boolean): string | null {
  if (/\s/.test(p.trim())) return "The prefix must not contain spaces.";
  if (required && !/[^/\s]/.test(p))
    return "The prefix is required for the Go backend.";
  return null;
}
export const prefixValid = (p: string, required: boolean): boolean =>
  prefixProblem(p, required) === null;

export function SpecForm({
  url,
  prefix,
  loading,
  prefixRequired,
  onUrl,
  onPrefix,
  onLoad,
}: Props) {
  const problem = prefixProblem(prefix, prefixRequired);
  const ok = url.trim() !== "" && problem === null;
  return (
    <section className="hero">
      <div>
        <h1>Turn an API's description into code you can use.</h1>
        <p className="lede">
          Every server publishes a list of what it can do. Paste the link to
          that list. GenroAPI reads it and writes the TypeScript, Tanstack
          Query, Zod, Zustand and Go proxy files for you, so nobody types them
          by hand.
        </p>
        <form
          className="load-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok && !loading) onLoad();
          }}
        >
          <div className="load">
            <input
              value={url}
              aria-label="Swagger URL"
              onChange={(e) => onUrl(e.target.value)}
              placeholder="https://your-server/openapi.json"
              spellCheck={false}
            />
            <button type="submit" className="btn" disabled={!ok || loading}>
              {loading ? "Loading…" : "Load endpoints"}
            </button>
          </div>
          <label className="field prefix-field">
            <span>
              Service prefix <small>(only needed for Go routes)</small>
            </span>
            <input
              value={prefix}
              aria-label="Service prefix"
              onChange={(e) => onPrefix(e.target.value)}
              placeholder="/periodic"
              aria-describedby="prefix-help"
              aria-invalid={problem !== null && prefix.trim() !== ""}
            />
          </label>
          <p className="hint">
            The URL must be the spec document itself (JSON or YAML), not the
            Swagger UI page.
          </p>
          <p id="prefix-help" className="hint">
            The prefix is only used for the Go upstream path (required for Go,
            optional otherwise); a prefix already present in the spec paths is
            stripped first.
          </p>
          {problem && prefix.trim() !== "" && (
            <p className="err" role="note">
              {problem}
            </p>
          )}
        </form>
      </div>
      <div className="ba" aria-hidden="true">
        <div className="card">
          <small>What your server publishes</small>
          <div>
            <span className="t-keyword">GET</span>{" "}
            <span className="t-string">/periodic/tree</span>
            <br />
            returns: a list of <span className="t-type">Node</span>
            <br />
            cached for: 1 hour
          </div>
        </div>
        <div className="arrow">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3v13M4 11l6 6 6-6" />
          </svg>
        </div>
        <div className="card out">
          <small>What your app gets</small>
          <div>
            <span className="t-keyword">const</span> nodes ={" "}
            <span className="t-keyword">await</span>{" "}
            <span className="t-function">getTree</span>();
            <br />
            <span className="t-comment">// typed, checked, ready</span>
          </div>
        </div>
      </div>
    </section>
  );
}
