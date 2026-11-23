# filesystem

Read, write, search and manage files on the host, as an MCP server. Every path is checked against an
allowlist before anything touches disk.

```bash
npm install @x-agint/filesystem
```

```jsonc
// stdio (the usual form — the host spawns it)
{ "mcpServers": { "filesystem": { "command": "x-filesystem" } } }
```

- npm: `@x-agint/filesystem` · latest **1.0.3**
- tools: **16** (read live from `tools/list`, not copied from docs)
- transport: stdio by default; HTTP for a remote machine

---

## The allowlist is the security model

Every handler starts with `validatePath(path, config)` — no path reaches the filesystem unvalidated. It:

1. enforces the allowlist **lexically**,
2. follows symlinks via `realpath` (so a link out of the allowlist is caught),
3. for a new file, validates the **nearest existing ancestor**.

Allowed directories come from `~/.x-agint/core/user-env.json` plus `config.json`, and are **replaced by
MCP roots when a client offers them**. Read them at call time from the bound config — never cache a
startup snapshot (that is why `list_allowed_directories` reads config on every call).

The file is written by the `chat` service on startup, so if that never starts, paths fall back to system
defaults (`~/Downloads`, `~/x-works`, the system temp dir, `~/.x-agint`).

> **On a remote box the allowlist is enforced on that machine.** Nothing a client sends widens it; MCP
> roots can only *narrow* what is offered.

---

## Tools (16)

### Reading — the interesting part

#### `filesystem_read_text_file(path, offset?, count?, tryFullRead?)`

The range semantics are worth reading once, carefully:

| Behaviour | Detail |
|---|---|
| Default | first **50** lines |
| `offset` | **1-based**; **negative counts from the end** (`-1` is the last line); `0` is treated as `1` |
| `count` | positive reads forward from the anchor; **negative reads backwards ending at the anchor (inclusive)**; `0` returns empty; absolute value capped at **500** |
| `tryFullRead` | reads as much as possible from `offset`, capped at **500**; `count` is ignored but `offset` still anchors — so `offset + tryFullRead` continues a long file instead of restarting at line 1 |

So the tail of a log of unknown length is just:

```jsonc
{ "path": "/var/log/app.log", "offset": -50 }
```

Every result reports `from` / `to` (1-based inclusive, `0` for an empty window) and `total`. Truncation is
never silent. A paged payload always leads with its describing line: an empty window (`count: 0`, or an
offset past the end) still returns that one line with `from`/`to`/`total` at 0 — do not expect `""`.

#### `filesystem_read_for_llm(path)`

Read a file and hand it to the model directly. Accepts text (TXT, MD, CSV, HTML, JSON, YAML, LOG, INI,
TOML), images, audio, PDF and Office documents; text returns as UTF-8, everything else base64. Whether a
type is accepted depends on the target LLM page.

### Writing and editing

| Tool | Args | Notes |
|---|---|---|
| `filesystem_write_file` | `path`, `content` | **overwrites without warning.** Prefer `edit_file` |
| `filesystem_edit_file` | `path`, `edits[]`, `dryRun?`, `needDiff?` | array of exact-text `oldText` → `newText`; `dryRun` previews a git-style diff, `needDiff` returns one |

Writes are **atomic**: `wx` + temp file + rename.

`edit_file` matches *exactly*, which cuts both ways — it cannot misspell its way into a wrong edit, but a
too-short anchor can match more than once. Use an anchor long enough to be unique, or `dryRun` first.

### Directories and metadata

| Tool | Args |
|---|---|
| `filesystem_create_directory` | `path` — nested dirs in one call; succeeds silently if it exists |
| `filesystem_list_directory` | `path` — names only |
| `filesystem_list_directory_ex` | `path`, `sortBy?` (name/size/modified), `sortType?`, `offset?` (1-based), `count?` (max 100), `pattern?` — structured metadata: size, mtime, permissions |
| `filesystem_get_file_info` | `path` — size, creation and modification time, permissions, type |
| `filesystem_list_allowed_directories` | — the current allowlist; call it before guessing paths |

### Search — use this instead of walking directories

| Tool | Args |
|---|---|
| `filesystem_search_files` | `path`, `pattern` (glob, e.g. `**/*.ts`), `excludePatterns?` — full paths, max 1000 |
| `filesystem_search_text` | `directory`, `searchText`, `filePattern?`, `caseSensitive?`, `wholeWord?`, `useRegex?`, `timeoutMs?` — ripgrep, with file path + line number, max 1000 |

`search_text` passes arguments through `execFile(rgPath, argv[])` — never a shell string built from user
input.

### File operations

| Tool | Args | Notes |
|---|---|---|
| `filesystem_move_file` | `source`, `destination` | move and rename in one operation; **fails if the destination exists** |
| `filesystem_delete_file` | `path` | **soft delete** — moves to a trash directory rather than unlinking; works on directories too |
| `filesystem_download_file` | `url`, `saveDirPath?`, `timeoutMs?` (default 120000) | HTTP/HTTPS; filename taken from the URL; defaults to the system temp dir; returns saved path + size |

### Meta

| Tool | Args | Purpose |
|---|---|---|
| `filesystem_trigger_discovery` | `path` | walk up from `path` triggering AGENTS.md / `.agents` discovery |
| `filesystem_readme` | — | built-in usage guide |

---

## The prefix you will see on remote instances

When an instance sets `mcpHostName`, its tools arrive prefixed:

```
x-ros2__filesystem_read_text_file(path, offset?, count?, tryFullRead?)
x-ros2__filesystem_edit_file(path, edits, dryRun?, needDiff?)
```

Intentional: with several hosts mounted at once, the prefix tells a client which machine a call lands on,
and distinguishes `x-ros2__filesystem_*` from `x-ros2__bashsystem_*`.

---

## Configuration

```bash
x-filesystem --config-path ~/.x-agint/filesystem/tailscale-config.json \
  --server start            # also: status, stop, restart
```

One config file **per channel**; lifecycle state lives beside it as `<name>-state.json`, so every
`--server` action must name the config. Default HTTP port is **3061** — pick a dedicated port per profile
so profiles never collide.

| Key | Note |
|---|---|
| `mcpHost` | keep the primary instance on `127.0.0.1` and front it with `tailscale serve`; bind `0.0.0.0` only for a LAN backup profile |
| `mcpAuthToken` | required on any off-loopback bind; clients present it in **`X-MCP-Endpoint`**. A token never changes what is bound |
| `mcpHostName` | set it so tools arrive as `<host>__filesystem_*` |

---

## See the same calls in the demos

The demo material under [`assets/flight-demo/`](../../assets/flight-demo/) and
[`assets/migu-demo/`](../../assets/migu-demo/) is all written and read back through these tools. Each frame
is saved by the very call that produced it — a screenshot tool passed a `filePath` inside the allowed
directories — and the per-frame record beside it is a plain JSON file:

```jsonc
filesystem_read_text_file({ "path": "assets/migu-demo/steps.json", "tryFullRead": true })
// -> { content, from: 1, to: 26, total: 26 }   ← the tool behind each frame, in call order
```

Two conventions that page follows, and that the demos depend on: `image` fields are **bare filenames**
resolved relative to the steps file (so a demo directory stays movable), and reads report `from` / `to` /
`total` so the agent knows whether to page further instead of assuming it saw everything. The walkthroughs
themselves are in [browser.md](../browser/browser.md).

---

## Gotchas

1. **`dist/index.js` is a library barrel, not an entry point** — importing it never starts a server, so a
   launcher pointed there hangs the handshake. The executable is `dist/bin/x-filesystem.js`.
2. **Do not pass directories as positional arguments** to the CLI; they are ignored. Use `--config-path`
   and config keys.
3. **`search_text` needs ripgrep resolvable at runtime** — `@vscode/ripgrep` is deliberately *not* bundled,
   because it locates its own installation directory, which a static bundle breaks.
4. **Config edits apply only on restart**, then probe the live channel with one allowed path and one
   refused path — do not trust the file edit.
5. **A temp `HOME` in tests must contain `~/x-works`** — that directory is in the allowlist by default, and
   an allowlisted directory that does not exist makes the server report *working directory not accessible*.
