# bashsystem

Run shell commands on the host, as an MCP server.

```bash
npm install @x-agint/bashsystem
```

```jsonc
// stdio (the usual form — the host spawns it)
{ "mcpServers": { "bashsystem": { "command": "x-bashsystem" } } }
```

- npm: `@x-agint/bashsystem` · latest **1.0.3**
- tools: **7** (read live from `tools/list`, not copied from docs)
- transport: stdio by default; HTTP for a remote machine

---

## The permission model — the part worth understanding

A command is refused only when it matches a blacklist. Everything else runs. There are two blacklists,
and they are deliberately not merged:

| Layer | Where it lives | Removable? |
|---|---|---|
| Hard blocks | compiled into the server (`getHardBlockedCommands()`) | **no** — never written to config |
| Configurable blocks | `blockedCommands` in `config.json` | yes |
| sudo | `sudoCommands` — an **allowlist**: a match means *permitted* | per-user policy |

They are merged **at match time**, not at load time, so `Config.blockedCommands` holds only the user's
entries and hard blocks never reach the config file. Do not "simplify" that.

### Why `rm` is not a pattern

A deny-list of dangerous paths always misses one — and macOS has no `realpath -m`. So the `rm` guard
checks the target against an **allowlist of directories**: allowed when it resolves inside one, refused
otherwise. It is still reported through `getBlockedReason()` like any hard block, and it is never
configurable.

This is what a regex-based deny-list could not express (all refused):

```bash
{ rm -rf /etc; }          # command boundary detected
( rm -rf /usr )           # subshell
if true; then rm -rf /    # control keyword — the tokenizer keeps `then`/`do` as ordinary words
for x in a; do rm -rf /   # loop body
case x in *) rm -rf / ;;  # case arm
! rm -rf /                # negation
env X=1 rm -rf /var       # exec wrapper unwrapped to the real command
time nice -n 5 rm -rf /   # nested wrappers, option value in its own word
```

Measured: the original deny-list leaked **12 of 16** such forms. Token-level checking is what holds.

The guard also fails closed on its own blind spots: an unparsable line is refused, a glob is judged as
its pattern (never assumed expanded), and a redirection destination is judged as a write.

### Other structural guards

| Guard | Note |
|---|---|
| `mkfs`, raw-device writes | catches `dd of=/dev/disk…`; `dd` has **no** blanket rule — that would be redundant with raw-device |
| `find -exec` | judged by its **reconstructed payload**; `{}` maps to find's *leading* operands only (a test flag's value like `-name x` is not a start) |
| `find -execdir` + deleting payload | refused outright — per-match-directory execution cannot be confined |
| `su`, `doas` | hard-blocked, no allowlist (unlike sudo) |
| `chmod` | only the **recursive** form is policed, on purpose; an allowed directory itself may be chmod'ed |

`sudo` is *not* a hard block — making it one turns the sudo module into dead code. And blocked does not
look through `sudo`; the sudo module re-checks the payload itself. A probe that calls only
`getBlockedReason()` reports `sudo rm -rf /` as a leak when it is in fact refused by
`getSudoDeniedReason()`.

> These checks are a safety net, not a sandbox (`bash script.sh`, `eval` defeat them). Real boundaries
> are `sudoCommands`, `NOPASSWD`, the allowed directories, and the user the server runs as.

---

## Tools (7)

### `bashsystem_execute_command(command, workingDirectory?, background?, timeoutMs?)`

> Execute a terminal command on the host machine. A command is refused only if it matches the blacklist
> (code hard-blocked patterns plus config.json blockedCommands); all other commands are allowed.

**A non-zero `exitCode` is a result, not a tool error.** The call returns normally with `exitCode`,
`stdout`, `stderr`. Only commands that never ran (empty, blocked) throw. Check `exitCode` before parsing
output.

```jsonc
{ "command": "git status", "workingDirectory": "/repo" }
// -> { exitCode: 0, stdout: "…", stderr: "", currentDirectory: "/repo" }
```

**Long-running work does not block the call:**

```jsonc
{ "command": "npm run dev", "background": true }
// -> { status: "backgroundStarted", pid, pgid, logPath }
```

Read output with `tail -n 100 <logPath>`; stop the whole group with `kill -TERM -<pgid>`.

Foreground commands are detached into their own process group, so cleanup sends `SIGKILL` to `-pgid` and
reaches **grandchildren** — not just the shell. Background commands are registered for visibility but
**never swept**: they get no `exitPromise`, because a dev server must outlive the call that started it.

`timeoutMs` applies only in the foreground; it is ignored when `background: true`.

### The other six

| Tool | Args | Purpose |
|---|---|---|
| `bashsystem_set_cwd` | `path` | change the working directory for subsequent commands |
| `bashsystem_get_cwd` | — | current working directory |
| `bashsystem_list_allowed_directories` | — | which directories may be used as working directories |
| `bashsystem_list_spawned` | — | tracked processes: foreground still running + background survivors, each with `pgid`, spawn time and command/cwd (plus `logPath`) — use the `pgid` to inspect or stop a group |
| `bashsystem_trigger_discovery` | `path` | walk up from `path` triggering AGENTS.md / `.agents` discovery |
| `bashsystem_readme` | — | built-in usage guide (best practices + CLI) |

---

## Configuration

Two config interfaces, kept separate on purpose:

| Interface | Used by | Writes defaults? |
|---|---|---|
| `loadConfig()` | server runtime | yes — defaults applied |
| `--config key=value` (CLI) | user settings | **no** — only keys you set |

Never writing defaults to disk is what lets a future default change reach you. Keys:

```bash
x-bashsystem --config mcpHost=127.0.0.1     # bind address; a token never changes what is bound
x-bashsystem --config mcpPort=3062
x-bashsystem --config mcpAuthToken=s3cret   # require X-MCP-Endpoint: s3cret
x-bashsystem --config mcpHostName=x-ros2    # tools arrive as x-ros2__bashsystem_*
x-bashsystem --server start|stop|restart|status
```

### The agent rc — `~/.x-agint/bashsystem/.agentrc`

This is **the agent's own rc file**, not the user's shell profile. Every command sources it first, so its
exports and aliases (including the `x-*` CLIs) apply to your commands. Editing it takes effect on the next
command — no restart. Created at startup, never overwritten. Keep it silent: exports and aliases only.

`loadShellProfile` (sourcing `~/.zshrc`) is the trust boundary: it runs arbitrary user code and exports its
environment, secrets included. It defaults to **off**, and even when on, a missing or broken profile never
blocks the command.

---

## Serving a remote machine

The pattern that survived a full reboot drill (reboot → `@reboot` bootstrap → agent reconnects with no
client-side action):

| Instance | Bind | Purpose |
|---|---|---|
| primary | loopback only, fronted by `tailscale serve` (tailnet-only HTTPS) | day-to-day channel |
| LAN backup | `0.0.0.0`, started **by hand on demand** | no autostart, deliberately |

```jsonc
{
  "mcpServers": {
    "remote-box": {
      "url": "https://<tailnet-host>/bs/mcp",
      "headers": { "X-MCP-Endpoint": "<mcpAuthToken>" }
    }
  }
}
```

Hard-won rules:

- **Header is `X-MCP-Endpoint`, not `Authorization: Bearer`.** A client that cannot send custom headers
  needs a proxy that injects it.
- **Set `mcpHostName`** so you know whose shell a call reaches (`x-ros2__bashsystem_execute_command`).
- **Install the `@reboot` bootstrap before you need it.** `tailscale serve` rules and hand-started
  instances are both gone after reboot — losing the only reachable channel historically cost a manual
  power-cycle. The script must export the nvm bin dir (cron's PATH is minimal) and use tailscale ≥1.82
  syntax (`--set-path`, not a trailing URL path).
- **Restart *between* operations, never during one.** `--server restart` on the instance you are talking
  through is safe but drops your connection mid-call; never chain it with follow-up commands in one call.
- **Rebooting through the channel:** expect `fetch failed` — that error *is* the success signal. Never
  retry it; wait ~1 minute, reconnect, verify.
- **Verify state, don't infer it.** PID 1's age / `/proc/uptime` for a reboot, `ss -ltn` + `--server
  status` for an instance. (`uptime` alone once fooled an agent into reporting a reboot that never
  happened.)
- **Config edits need a restart to take effect**, then probe the live channel with one allow case and one
  deny case per changed rule.

---

## Gotchas

1. **`dist/index.js` is a library barrel, not an entry point.** Importing it has no side effects and never
   starts a server — pointing a launcher there makes the MCP handshake hang. The executable is
   `dist/bin/x-bashsystem.js`.
2. **Result fields are the wire contract** (`exitCode`, `logPath`, `timedOut`, `currentDirectory`,
   `allowedDirectories`, `status: 'backgroundStarted'`). Renaming one is a breaking change for clients.
3. **The rm guard does not expand `$VAR/...` or `~`** — it treats them as relative and refuses. Write
   literal absolute paths inside allowed directories when you intend to delete.
4. **A command containing blocked *text* can be refused even in a heredoc.** The guard inspects the whole
   command line, so writing a script that mentions `rm -rf` inside a `cat <<EOF` may trip it. Write the
   file with the filesystem tools instead.
5. **Stop a service with `pm2 delete`, not `pm2 stop`** — `stop` leaves it registered and collides with the
   next start.
