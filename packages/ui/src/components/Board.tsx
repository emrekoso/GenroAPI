import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Endpoint, GoMode } from "@genroapi/core";
import type { GroupModel } from "../groupViz";
import { EndpointTable } from "./EndpointTable";

interface Props {
  endpoints: Endpoint[];
  model: GroupModel;
  showGo: boolean;
  errors: Record<string, string>;
  groupErrors: Record<string, string>;
  /** Prefix of the file path currently shown in the preview (a file name, or `<slug>.` for a whole group). */
  selectedPrefix: string | null;
  onSelectFile(prefix: string): void;
  onChange(id: string, patch: Partial<Endpoint> & { goMode?: GoMode }): void;
  onEnableAll(ids: string[], enabled: boolean): void;
  onGroupAll(ids: string[], group: string): void;
}

interface Wire {
  d: string;
  colour: string;
}

/** Endpoints on the left, the files they become on the right, one coloured wire per enabled endpoint. */
export function Board({
  endpoints,
  model,
  showGo,
  errors,
  groupErrors,
  selectedPrefix,
  onSelectFile,
  onChange,
  onEnableAll,
  onGroupAll,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<Wire[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The draw-in animation plays once, on the first set of wires only.
  const [intro, setIntro] = useState(true);

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const b = board.getBoundingClientRect();
    const list = board.querySelector(".rows")?.getBoundingClientRect();
    const targets = new Map<string, HTMLElement>();
    board
      .querySelectorAll<HTMLElement>("[data-stack-in]")
      .forEach((el) => targets.set(el.dataset.stackIn!, el));
    const next: Wire[] = [];
    board.querySelectorAll<HTMLElement>("[data-port]").forEach((port) => {
      const e = endpoints.find((x) => x.id === port.dataset.port);
      const group = e && model.groupOf.get(e.id);
      const target = group ? targets.get(group) : undefined;
      if (!e || !e.enabled || !target) return;
      const a = port.getBoundingClientRect(),
        t = target.getBoundingClientRect();
      // Rows scrolled out of their list have no visible start, so they get no wire.
      if (
        list &&
        (a.top + a.height / 2 < list.top || a.top + a.height / 2 > list.bottom)
      )
        return;
      const x1 = a.left + a.width / 2 - b.left,
        y1 = a.top + a.height / 2 - b.top;
      const x2 = t.left + t.width / 2 - b.left,
        y2 = t.top + t.height / 2 - b.top;
      const k = (x2 - x1) * 0.55;
      next.push({
        d: `M${x1} ${y1} C${x1 + k} ${y1},${x2 - k} ${y2},${x2} ${y2}`,
        colour: model.colourOfGroup(group!),
      });
    });
    setSize({ w: b.width, h: b.height });
    setWires(next);
  }, [endpoints, model]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    ro?.observe(board);
    const rows = board.querySelector(".rows");
    rows?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro?.disconnect();
      rows?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  useEffect(() => {
    if (!intro || wires.length === 0) return;
    const t = setTimeout(() => setIntro(false), 1800);
    return () => clearTimeout(t);
  }, [intro, wires.length]);

  return (
    <div className="board" ref={boardRef}>
      <svg
        className={`wires${intro ? " draw" : ""}`}
        viewBox={`0 0 ${size.w} ${size.h}`}
        aria-hidden="true"
      >
        {wires.map((w, i) => (
          <path
            key={i}
            d={w.d}
            pathLength={1}
            stroke={w.colour}
            style={intro ? { animationDelay: `${i * 60}ms` } : undefined}
          />
        ))}
      </svg>
      <EndpointTable
        endpoints={endpoints}
        showGo={showGo}
        errors={errors}
        groupErrors={groupErrors}
        colourOf={(id) => model.colourOfGroup(model.groupOf.get(id) ?? "")}
        onChange={onChange}
        onEnableAll={onEnableAll}
        onGroupAll={onGroupAll}
      />
      <div />
      <div className="pane">
        <h3>
          Files you get{" "}
          <span>
            {model.stacks.reduce((n, s) => n + s.files.length, 0)} files
          </span>
        </h3>
        <div className="stacks">
          {model.stacks.length === 0 && (
            <div className="empty">
              Nothing selected yet. Tick an endpoint on the left to see its
              files appear here.
            </div>
          )}
          {model.stacks.map((s) => (
            <div
              key={s.group}
              className="stack"
              aria-current={
                selectedPrefix?.startsWith(`${s.slug}.`) ? "true" : undefined
              }
              style={{ "--c": s.colour } as React.CSSProperties}
            >
              <span className="in" data-stack-in={s.group} aria-hidden="true" />
              <button
                type="button"
                className="hd"
                onClick={() => onSelectFile(`${s.slug}.`)}
                aria-label={`Show ${s.group} files`}
              >
                <b>
                  <i />
                  {s.group}
                </b>
                <span>
                  {s.count} {s.count === 1 ? "endpoint" : "endpoints"}
                </span>
              </button>
              <ul className="stack-files">
                {s.files.map((f) => (
                  <li key={f.kind}>
                    <button
                      type="button"
                      className="file"
                      aria-pressed={selectedPrefix === f.file}
                      onClick={() => onSelectFile(f.file)}
                      aria-label={`Show ${f.file}`}
                    >
                      <span className={`ic ${f.lang}`}>
                        {f.lang === "go" ? "GO" : "TS"}
                      </span>
                      <span className="fn">{f.file}</span>
                      <span className="fd">{f.desc}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
