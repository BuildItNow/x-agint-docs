# AGENTS.md — @x-agint/github-docs

This file is for **AI agents working in this repository**. It records what the repo is, its conventions
and the pitfalls that make its output wrong.

User-facing documentation lives in `README.md` and `docs/`; this file does not repeat it.

---

## 1. What this repository is

`@x-agint/github-docs` is the **documentation and demo-capture repository** for the three published x-agint MCP
servers (`@x-agint/bashsystem`, `@x-agint/filesystem`, `@x-agint/browser`).

It contains **no server source**. The npm packages are published; their sources are not. Everything here is
documentation plus scripts that drive the *published* servers over MCP, so every asset can be regenerated
without the implementation.

| Path | Nature |
|---|---|
| `README.md` | Landing page: hero, four demo galleries (all are **browser-server demos**, grouped under the browser section), per-server overview, install, benchmarks, the Tools index, design notes |
| `docs/bashsystem/bashsystem.md` | bashsystem tool reference (7 tools) + permission model |
| `docs/filesystem/filesystem.md` | filesystem tool reference (16 tools) + allowlist and line-window reads |
| `docs/browser/browser.md` | browser tool reference (33 tools) + `[N]` index model, markers, cost order; the frame-by-frame gallery section holds all four demos (flight, playlist, inspect, publish-to-github) |
| `docs/browser/debugging.md` | console/network capture write-up with a real migu streaming trace |
| `docs/browser/inspect-demo.md` | the third demo in full: reading one small inline XHR + the console log off a live Yahoo Finance market page |
| `assets/flight-demo/`, `assets/migu-demo/`, `assets/github-demo/` | The acting demos: frames, GIFs, and the `steps.json` behind each (`github-demo` publishes a repo to GitHub — dashboard → create menu → fill name → created repo → pushed tree) |
| `assets/inspect-demo/` | The inspect (reading) demo: two intermediate-state frames + the two raw capture logs (`network-excerpt.jsonl`, `console-excerpt.jsonl`), credential-redacted |
| `scripts/make-gif.mjs` | The only script kept — composes a GIF from a `steps.json` |

**56 tools total across the three servers.** Tool counts must stay in sync between the README Tools table and
each doc page's headings — a stale count is the most common drift here.

---

## 2. Non-negotiable rules

### Every claim comes from a real run

Every screenshot, GIF, price, play count and tool output in this repo was captured live through the published
servers against real websites — no mockups, no fixtures, no invented output. When writing an example, use a
value a tool actually returned (e.g. `厦航 MF8150 ¥260`, `共161首`, `playlistId=227616725`). If a number is
illustrative rather than measured, say so in the sentence.

### Never log in, never pay, never submit on a user's behalf

Demos stop at the authentication wall. The flight demo deliberately ends at `login.taobao.com` with the
order-confirm URL visible in `redirectURL` — that is the correct endpoint of the flow, not something to work
around. No credentials are held in this repository and none should be used.

### Judge from tool returns, not from claims

When documenting what an agent did, cite the **return value** that proves it: a `playing-row` class
appearing or disappearing, a frozen timestamp, a column title flipping to 「点击按票价从高到低」. A sentence
saying "the click worked" with no quoted evidence is not acceptable here.

### Keep one subject in one file

Per-server detail belongs to that server's doc page; `README.md` keeps the overview and the demos. Do not fork
a second copy of an explanation — cross-reference instead, and refer to tools by their **full name**
(`browser_get_viewport_content`, never `get_page_content`).

---

## 3. Asset conventions

Two asset shapes, one directory per demo:

```
assets/<demo>/
├── <NN>-<slug>.jpg       Frames, named in call order so alphabetical == chronological
├── steps.json            The tool behind each frame
└── <demo>.gif            Assembled from the frames by scripts/make-gif.mjs   (acting demos only)
```

The three *acting* demos (flight, playlist, publish-to-github) follow the layout above — every frame is a
screenshot and a GIF is assembled from them. The *reading* demo (`inspect-demo`) instead commits **raw capture logs
as evidence**: `network-excerpt.jsonl` + `console-excerpt.jsonl` (contiguous slices of inspect's two per-channel
JSONL logs, credential-redacted) plus the intermediate-state frames — no GIF. Its `steps.json` keys differ
accordingly (`networkLog` / `consoleLog` instead of a single GIF).

- **`steps.json` `image` fields are bare filenames**, resolved relative to the steps file itself — not repo-root
  paths. Keep it that way so the directory stays movable.
- Frames are written **by the tool call they show**: pass `filePath` in that same call, so the image and the tool
  log cannot disagree. There is no separate screen recorder.
- The caption strip names the **tool only**. Arguments are long and belong in prose; a solid opaque bar hid the
  page content underneath it, which is why the strip is translucent (`BAR_HEIGHT=48`, a three-stop gradient at
  `.15 → .45 → .72`, plus text-shadow). Verify legibility by comparing the composited raw YAVG against the
  frame's, rather than trusting a screenshot.
- GIF frame timing lives in `steps.json`; all three **acting** demos use 2.2 s per frame. Regenerate with
  `npm run gif:flight` / `npm run gif:migu` / `npm run gif:github` (`--steps` is required; `--out` defaults to the
  steps file's directory). The inspect demo has no GIF — its evidence is the two log excerpts.
- Scratch output goes to `mkdtempSync(tmpdir())`, never into the repo.

### Relative paths depend on document depth

Docs live one level deeper than the repo root, so a page in `docs/browser/` references `../../assets/...` and
`../../scripts/...`, while the README uses `assets/...`. Getting this wrong yields images that render on GitHub
but break for local viewers, so check both whenever a file moves.

---

## 4. Editing conventions

- Markdown style follows the existing pages: `---` between sections, tables over prose for comparisons, fenced
  blocks tagged `bash` / `jsonc` / `js` / `text`.
- Mixed CN/EN is expected: site labels stay Chinese, prose stays English. Keep em dash and `·` usage consistent
  with neighbouring text.
- No trailing whitespace, no stray blank line at EOF. `git diff --cached --check` must report nothing — there
  are no git hooks here, so this check runs only if someone remembers it.
- Commit message style: `# <module> - <summary>: <details>`.

---

## 5. Verification before committing

There is **no CI and no test suite** in this repository; local checks are the only line of defense.

```bash
# every asset path referenced from README *and* the doc pages must exist on disk
grep -ohE 'assets/[A-Za-z0-9_./-]+' README.md docs/*/*.md | sort -u | while read -r f; do [ -e "$f" ] || echo "MISSING $f"; done

# committed .jsonl evidence must parse line by line
for f in assets/inspect-demo/*.jsonl; do python3 -c "import json,sys;[json.loads(l) for l in open(sys.argv[1])];print('ok',sys.argv[1])" "$f"; done

# code fences must balance — an unbalanced fence silently swallows the rest of a section
grep -cE '^```' README.md docs/*/*.md   # every count must be even

node --check scripts/make-gif.mjs
npm run gif:flight && npm run gif:migu

git add -A && git diff --cached --check; echo "ws=$?"   # must be ws=0
```

Use plain `grep` plus `[ -f ]` for asset-path checks — a complex `sed` pipeline once produced false-positive
BROKEN reports and wasted a cycle. If no check covers a change, **say so** rather than implying it was verified.

---

## 6. Pitfalls

1. **`filesystem_edit_file` with `dryRun: true` returns only `{succeed: true}` here — no diff.** It is not a
   preview; verify the real edit afterwards instead of relying on it.
2. **Fliggy's filter checkboxes are `<li>` elements styled as tickers.** `browser_page_uncheck` refuses them
   ("Not a checkbox") because they genuinely are not — use `browser_page_click`. Do not "fix" the docs back to
   `uncheck`.
3. **A very long heredoc in one shell call risks a malformed tool-call payload**, and the write is then lost
   outright. Write large files with `filesystem_write_file`, or split into several smaller calls.
4. **Tool counts drift.** After adding or removing a tool on a server, update that page's heading, its category
   headings, and the README Tools table plus total.
5. **Do not reintroduce a deleted page's links.** `docs/benchmarks.md` and `docs/tools.md` are gone; the Tools
   index now lives in `README.md`. Grep for the old paths before committing.
6. **A stale browser daemon keeps the tool catalog from the build it started with**, so a capture or a
   `tools/list` read can report tools that no longer exist upstream. That is an environment problem — restart the
   daemon, do not edit the docs to match.
7. **`.DS_Store` is gitignored**; if one shows up in `git status`, it was tracked before the ignore rule and needs
   `git rm --cached`.
8. **Inspect captures are deleted when the page closes.** `browser_page_close` stops capture *and deletes the
   whole capture directory*, so read or copy the JSONL before closing — a demo written afterwards cannot recover
   it. Commit only a filtered excerpt: raw captures carry cookies, ad identifiers and full request URLs for
   third-party sites this repo does not own.
9. **Start the capture channel before the action that produces the traffic.** Enabling `network` after the click
   misses the request the click caused, and there is no retroactive capture.
