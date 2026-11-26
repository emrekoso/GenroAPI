export type InputMode = "url" | "text";
export const MAX_SPEC_BYTES = 20 * 1024 * 1024;

interface Props {
  mode: InputMode;
  text: string;
  onMode(m: InputMode): void;
  onText(v: string): void;
  onError(msg: string): void;
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

const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("Could not read the file"));
    r.readAsText(file);
  });

export function SpecForm({
  mode,
  text,
  onMode,
  onText,
  onError,
  url,
  prefix,
  loading,
  prefixRequired,
  onUrl,
  onPrefix,
  onLoad,
}: Props) {
  const problem = prefixProblem(prefix, prefixRequired);
  const hasSpec = mode === "url" ? url.trim() !== "" : text.trim() !== "";
  const ok = hasSpec && problem === null;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_SPEC_BYTES) return onError("That file is too large (limit 20 MB).");
    if (!/\.(json|ya?ml)$/i.test(file.name)) return onError(`${file.name} is not a .json, .yaml or .yml file.`);
    try {
      const content = await readText(file);
      // A binary file read as text contains NUL or replacement characters; never overwrite the textarea with it.
      if (/[\u0000\uFFFD]/.test(content)) return onError(`${file.name} is not a text file.`);
      onText(content);
    }
    catch (e) { onError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <section className="hero">
      <div>
        <h1>Turn an API's description into code you can use.</h1>
        <p className="lede">
          Every server publishes a list of what it can do. Paste the link to
          that list, or the file itself. GenroAPI reads it and writes the TypeScript, Tanstack
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
          <div className="seg" role="radiogroup" aria-label="Spec source">
            <label className={mode === "url" ? "on" : ""}>
              <input type="radio" name="spec-source" checked={mode === "url"} onChange={() => onMode("url")} />
              From URL
            </label>
            <label className={mode === "text" ? "on" : ""}>
              <input type="radio" name="spec-source" checked={mode === "text"} onChange={() => onMode("text")} />
              Paste or upload
            </label>
          </div>
          {mode === "url" ? (
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
          ) : (
            <div className="paste">
              <textarea
                value={text}
                aria-label="Spec text"
                onChange={(e) => onText(e.target.value)}
                placeholder="Paste the JSON or YAML here, or choose a file below"
                spellCheck={false}
                rows={8}
              />
              <div className="paste-row">
                <label className="file">
                  <span>Choose a .json or .yaml file</span>
                  <input
                    type="file"
                    aria-label="Upload spec file"
                    accept=".json,.yaml,.yml,application/json,text/yaml,text/plain"
                    onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </label>
                <button type="submit" className="btn" disabled={!ok || loading}>
                  {loading ? "Loading…" : "Load endpoints"}
                </button>
              </div>
            </div>
          )}
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
            {mode === "url"
              ? "The URL must be the spec document itself (JSON or YAML), not the Swagger UI page."
              : "Paste or upload the spec document itself (JSON or YAML). It is read on your computer and never saved."}
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
