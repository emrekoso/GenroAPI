# GenroAPI [![npm](https://img.shields.io/npm/v/genroapi)](https://www.npmjs.com/package/genroapi)

A local web tool and CLI that turns a Swagger / OpenAPI document into:

- TypeScript types and axios service functions (always),
- optional TanStack Query hooks, Zod schemas and Zustand stores,
- an optional Go router file that registers `router.HandleProxy(...)` style routes for your Go proxy server.

Specs can be **JSON or YAML**, Swagger 2.0 or OpenAPI 3.x. The URL you paste must be the **spec document itself**
(e.g. `/openapi.json`, `/openapi.yaml`, `/swagger/doc.json`, `/v3/api-docs`), not the Swagger UI page. If you paste a
UI page, the tool says so and suggests the spec URL when it can find one.

## Requirements

Node **>= 22.19** (the CLI checks this on start and exits with a message on older versions; use nvm/fnm to switch).

## Quick start

```bash
npx genroapi            # run once, no install
# or: npm install -g genroapi && genroapi
```

The tool opens in your browser. Everything runs on your machine; files are written only where you point it.

## Install from source (build and run)

```bash
npm install
npm run build          # builds the UI, then bundles the CLI into packages/cli/dist
npx genroapi           # starts the tool and opens the browser
```

Flags:

| Flag                  | Meaning                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`          | Port to listen on (default `0`: pick a free port)                                                                               |
| `--no-open`           | Do not open the browser                                                                                                         |
| `--cwd <dir>`         | Directory that holds `genroapi.config.json` and that relative output dirs resolve against (default: current dir; it must exist) |
| `--ui-dir <dir>`      | Serve a different built UI (default: the bundled one)                                                                           |
| `--help`, `--version` | Usage / version                                                                                                                 |

Other scripts: `npm test` (vitest), `npm run typecheck`.

## The flow in the UI

1. Give it the spec: switch between **From URL** and **Paste or upload**. Paste JSON or YAML into the box, or choose a `.json` / `.yaml` / `.yml` file (up to 20 MB). For the Go backend also enter the service prefix. Press **Load**.
2. Tick the endpoints to generate, rename them (names must be unique across all groups, valid JS identifiers, not reserved words) and pick a Go mode per endpoint (Go backend only). The **Group** column is editable: type any name (new or existing, suggestions are offered), or filter the table and use **Apply group** to move every shown endpoint at once. One group becomes one set of files and one Go `<Group>Router`, so this is how you combine endpoints, even from different tags, into one file set. Group names are trimmed, and spellings that differ only in case are merged. Every enabled endpoint needs a group. The preview is syntax coloured (TypeScript and Go).
3. Choose options: Query hooks, Zod, Zustand, Backend (None / Go), Go package name, Tea import path.
4. Set the output directories. The preview updates as you type; **Write...** is enabled only while the preview matches your current inputs.
5. **Write...** shows a diff per file: `new`, `same` or `changed`. Changed files are only overwritten when you tick them.

Your settings are saved to `genroapi.config.json` in `--cwd`. Per-endpoint choices (renames, modes) are not persisted.

### Service prefix

The prefix is used **only for the upstream path in the generated Go file** (`router.HandleProxy("/<name>", "<prefix><spec path>")`).
A prefix already present at the start of a spec path is not doubled, repeated slashes are collapsed. It is required for the
Go backend and optional otherwise; axios URLs never contain it.

### Where files go

Output directories are relative to `--cwd` (or absolute). Frontend files go to the frontend dir, the Go file to the backend dir. The page shows the absolute folder each one resolves to under the field (`→ /Users/you/project/src/api`); `~` is not expanded, so use an absolute path instead.
Only files named `*.gen.ts` / `*.gen.go` are ever written. For every group (OpenAPI tag, or first path segment when untagged), with slug `<g>`:

| File                 | When           |
| -------------------- | -------------- |
| `<g>.types.gen.ts`   | always         |
| `<g>.service.gen.ts` | always         |
| `<g>.zod.gen.ts`     | Zod on         |
| `<g>.query.gen.ts`   | Query hooks on |
| `<g>.store.gen.ts`   | Zustand on     |
| `<g>.gen.go`         | Backend Go     |

## Using the generated code

### Frontend

With the Go backend, the generated axios functions call `/<name>/...` routes (the endpoint name, then the spec's path parameters)
on the **Go server**. Point axios at it: set `axios.defaults.baseURL`, or configure your dev server proxy so `/<name>` reaches
the Go server. Endpoints whose Go mode is `none`, and everything when the backend is `None`, call the raw spec path on the same origin.

Query hooks and stores import the service as a namespace (`import * as svc from './<g>.service.gen'`), so endpoint names can't
collide with their locals. SSE endpoints become `subscribe<Name>(...pathArgs, params, onMessage, onError?)` (query params are
appended as a query string; pass `undefined` when all are optional and unused) and are skipped by the hooks and stores.

### Go

Register each generated router in your main router, in the package you chose (default `routers`):

```go
routers.PeriodicRouter(router)
```

`PeriodicRouter` comes from the group name; the exact line is shown in the write dialog. The file imports your Tea package
(`import tea "<Tea import path>"`) and defines `func <Group>Router(router *tea.Router)`.

Go modes:

| Mode          | Generated call                                      |
| ------------- | --------------------------------------------------- |
| `proxy`       | `router.HandleProxy(route, upstream)`               |
| `unsecure`    | `router.HandleProxyUnsecure(route, upstream)`       |
| `cache`       | `router.HandleProxyWithCache(route, upstream, ttl)` |
| `stream`      | `router.HandleStream(route, upstream)`              |
| `passthrough` | `router.HandleStreamPassthrough(route, upstream)`   |
| `none`        | no route (frontend calls the raw spec path)         |

SSE endpoints default to `stream`. For `cache`, the TTL field accepts shorthand such as `500ms`, `30s`, `5m`, `1h`
(emitted as `5*time.Minute`, with `"time"` imported), any other value as a raw Go expression, and empty means the constant
`CacheTTL`: when you use that, a `time.Duration` constant `CacheTTL` must exist in the routers package.

### Zod / Zustand / Query options

- **Zod**: a `<Name>ResponseSchema` per response; service functions validate responses with it.
- **Zustand**: one store per group with data/loading/error state and a `fetch<Name>` action per GET endpoint.
- **Query hooks** (TanStack Query v5): `use<Name>Query` for GET, `use<Name>Mutation` for other methods.

## Known limitations

- Non-JSON responses (and responses without a schema) become `void`.
- Imports in generated TS are extensionless (bundler module resolution).
- Array query params use axios' default serialization (`fields[]=a`).
- Path parameter names with dashes (`{param-name}`) may not work with Go 1.22 `net/http.ServeMux` wildcard rules (gorilla/chi are fine).
- Renames and Go modes are not persisted between regenerations.
- Shared schemas are inlined per endpoint (only circular component schemas become named types).
- One request body type and one response type per endpoint (the first JSON 2xx response).
- Only `application/json` request bodies are typed.
- External `$ref`s (to files or URLs) are not resolved; inline them or use internal `#/` refs.

## Security notes

- The server binds to `127.0.0.1` only and checks the `Host` and `Origin` headers; it accepts JSON bodies only and sets no CORS headers.
- It writes only files named `*.gen.ts` / `*.gen.go`, inside the directories you give, and refuses symlink escapes.
- It fetches the Swagger URL **server-side** (http/https only, 30 s timeout, 20 MB limit): anyone who can use the UI can make your machine request a URL.
- Pasted or uploaded specs are parsed in memory on your machine: nothing is fetched for them and the text is never saved to `genroapi.config.json` (only which input mode you used).
- External `$ref` file/http resolution is disabled, so a spec cannot pull local files into the output. YAML is parsed with the plain core schema (no custom tags) and a bounded alias count.
- There is no authentication: any local process can use the API. A per-session token is a possible future hardening.
- Static responses carry `nosniff`, `Referrer-Policy: no-referrer` and a restrictive Content-Security-Policy.
