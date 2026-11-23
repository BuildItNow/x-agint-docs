# Benchmarks

These are measured runs, not marketing numbers. Every figure below is transcribed from committed
benchmark reports; nothing is estimated or rounded up.

## Headline

| | |
|---|---|
| Model | `deepseek-v4-flash` |
| Tasks completed | **5 / 5** |
| Total wall time | **122.2 s** |
| Total tokens (provider-reported) | **774,650** |
| Cache-miss prompt tokens | **53,449** |
| Tool calls | **40** |

## Per task

| Task | Site | Success | Time | Total tokens | Cache-miss | Tool calls | Rounds |
|---|---|---|---|---|---|---|---|
| `local-heading` | local fixture | 1/1 | 5.9 s | 26,987 | 896 | 3 | 4 |
| `fixture-cheapest-high-rating` | local fixture | 1/1 | 9.1 s | 28,139 | 1,170 | 3 | 4 |
| `dangdang-search-book` | search.dangdang.com | 1/1 | 16.4 s | 46,770 | 10,410 | 3 | 4 |
| `migu-play-singer` | music.migu.cn | 1/1 | 18.8 s | 69,725 | 4,169 | 7 | 8 |
| `fliggy-hgh-ckg-cheapest-2pm` | fliggy.com | 1/1 | 72 s | 603,029 | 36,804 | 24 | 25 |

What each task actually asks:

- **local-heading** — read a page, report its main heading. Harness self-check.
- **fixture-cheapest-high-rating** — from a product list, find the cheapest item rated >= 4.5.
- **dangdang-search-book** — search a bookstore for 《三体》, report the first result's title and price.
- **migu-play-singer** — search for 林俊杰, open results, **start playback**, report that it started.
- **fliggy-hgh-ckg-cheapest-2pm** — on a live booking site, among Hangzhou -> Chongqing flights
  departing the day after tomorrow between 14:00 and 15:00, find the cheapest and report its
  departure time and price.

## How success is decided (this matters more than the pass rate)

**A judge reads tool results, never the model's claim.** Models assert success while failing, so a
task that passes because the model *said* it worked is a bug, not a result.

- **Playback is judged by behaviour, not labels.** A `暂停` (pause) label can be rendered while nothing
  plays. The judge checks the player's **timer advancing** — a clock cannot lie.
- **Reported values are re-derived from the page.** For the flight task the judge itself re-parses the
  result list, computes the cheapest fare in that window, and *then* requires the model's answer to
  contain that number. Asserting on the model's prose alone would let a wrong price pass.
- **Live values are derived at judge time**, never hard-coded — prices, dates and rankings change
  daily, so a task with baked-in expectations rots within days.
- **Every run cleans up its own pages** in a `finally`, so runs do not contaminate each other.

## The honest way to read the token cost

One task (`fliggy`) accounts for 603,029 of the 774,650 tokens — 24 tool calls over 25 rounds on a
live booking site with a long result list. The other four together are ~171k.

Token columns are kept separate on purpose, because merging them hides where the cost is:

| Column | Meaning |
|---|---|
| LLM In | prompt tokens summed over rounds (770,121 across tasks) |
| LLM Out | completion tokens (4,529) |
| Tool Out | local estimate of raw tool-result text (28,607) — **overlaps** with LLM In, since results are re-sent in later rounds; never sum it with the others |
| Total | provider-reported prompt + completion |
| Cache-Miss | prompt tokens not served from cache |

`Cache-Miss` and `Tool Out` are the two numbers the tool design actually controls — which is exactly
why the read tools are **windowed** (`offset`/`count`, `{INNERTEXT_MOREABLE total=508}`) and
**cost-ordered** (search before viewport read, viewport read before `evaluate`). A page read that
dumps everything is a real bill, paid again on every subsequent round.

## Caveats — read these before quoting the numbers

- **`Runs per task: 1`.** One run is noise, not a distribution. Treat "5/5" as "these tasks completed
  under these conditions", not as a reliability estimate. Use `--runs N` and read median/range.
- **Live websites.** The four web tasks depend on sites that change; a task can fail because a site
  redesigned, not because a tool regressed.
- **Not CI.** It needs an API key and network, and is deliberately excluded from automated runs.
- **A signal, not a leaderboard.** Five tasks is a small sample chosen to be representative of real
  agent work (read, search, filter, fill, verify) — not a benchmark to rank models on.
- **Stale daemon caveat.** The harness connects over MCP to a long-lived daemon, so it exercises the
  tool catalog that daemon started with. If a report names tools absent from current source, the
  environment is stale — the harness intentionally never kills processes it does not own.

## Reproduce

```bash
# type-check only, no run
npm run benchmark:check
node benchmark/src/run.ts --list        # confirm suites and tasks load

# cheapest real end-to-end run: local fixture, no network needed
node benchmark/src/run.ts --suite smoke

# the live suites (needs DEEPSEEK_API_KEY + network)
npm run benchmark
```

The harness drives the browser exactly as a user's MCP host does — it spawns `x-browser --transport
http`, connects over Streamable HTTP, and lists/calls tools through the protocol. It never imports
internal page managers or tool handlers, because measuring a path users never take would hide catalog
and description problems.

Reports land in `benchmark/output/<suite>.md` and are committed as the baseline for comparison.
