#!/usr/bin/env node
/**
 * Stamp the MCP tool call that produced each screenshot onto that screenshot, so the README
 * shows capability and evidence together instead of in two places.
 *
 * Same caption strip as make-gif.mjs (rendered in a browser, composited with ffmpeg overlay):
 * this ffmpeg build has no `drawtext`/`ass`/`subtitles`, so text cannot be drawn by a filter.
 * The caption carries the tool name only — arguments are omitted on purpose, they are long and
 * belong in prose.
 *
 * Output goes to assets/captioned/, leaving the raw captures untouched: the raw PNGs are the
 * full-resolution originals (2x device scale) used for anything that needs detail, and re-running
 * capture-assets.mjs regenerates them without clobbering annotated copies.
 *
 * Usage:
 *   node scripts/annotate-images.mjs                    # every mapping below
 *   node scripts/annotate-images.mjs flight migu form   # only names containing these
 */
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'assets');
const SHOTS = join(ASSETS, 'screenshots');
const OUT = join(ASSETS, 'captioned');

/** Caption width must match the scaled screenshot width or the bar will not span the frame. */
const WIDTH = 1280;

/**
 * Each entry: file -> the tool call that produced it.
 *
 * These are the calls actually made during capture (see scripts/capture-assets.mjs and
 * assets/demos/mcp-calls.jsonl), not guesses. Where several tools ran for one frame, the label
 * names the tool whose effect the frame shows.
 */
const MAP = [
    // Wikipedia: read, then scroll-then-read
    ['read-01-article', 'browser_page_open + browser_get_viewport_content'],
    ['read-02-scrolled', 'browser_page_scroll -> browser_get_viewport_content'],
    // Wikipedia search flow
    ['search-01-results', 'browser_page_fill + browser_page_press_key'],
    ['search-02-followed', 'browser_page_click'],
    // Form filling
    ['form-01-before', 'browser_page_open'],
    ['form-02-filled', 'browser_page_fill x2'],
    ['form-03-after', 'browser_page_click (submit)'],
    // Migu music: the four-step flow
    ['migu-01-library', 'browser_page_open'],
    ['migu-02-suggest', 'browser_page_fill'],
    ['migu-03-results', 'browser_page_click (suggestion)'],
    ['migu-04-playing', 'browser_page_click (play all)'],
    // Flights
    ['flight-01-results', 'browser_page_open + browser_get_viewport_content'],
    ['flight-02-dates', 'browser_page_click (departure field)'],
    ['flight-03-filters', 'browser_page_click (Stops)'],
];

function captionHtml(label) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:transparent;font-family:Menlo,monospace}
      .bar{width:${WIDTH}px;height:64px;box-sizing:border-box;background:#12121a;
           border-top:3px solid #2f6feb;display:flex;align-items:center;padding:0 18px}
      .mcp{font-size:13px;color:#7fd18a;margin-right:10px}
      .tool{font-size:24px;font-weight:700;color:#fff;letter-spacing:.3px}
    </style></head><body>
      <div class="bar"><span class="mcp">MCP</span><span class="tool">${escapeHtml(label)}</span></div>
    </body></html>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

async function loadPlaywright() {
    const candidates = [
        'playwright',
        ...(process.env.X_AGINT_PLAYWRIGHT
            ? [join(process.env.X_AGINT_PLAYWRIGHT, 'node_modules', 'playwright', 'index.js')]
            : []),
    ];
    for (const spec of candidates) {
        try {
            const mod = await import(spec);
            return mod.chromium ? mod : mod.default;
        } catch { /* next */ }
    }
    console.error('playwright is not resolvable; set X_AGINT_PLAYWRIGHT or run `npm install playwright`.');
    process.exit(1);
}

async function main() {
    const filters = process.argv.slice(2);
    const wanted = MAP.filter(([n]) => !filters.length || filters.some((f) => n.includes(f)));
    if (!wanted.length) {
        console.error(`nothing matches ${filters.join(' ')}; known: ${MAP.map(([n]) => n).join(', ')}`);
        process.exit(1);
    }

    mkdirSync(OUT, { recursive: true });
    const tmp = join(ASSETS, '.annotate-tmp');
    mkdirSync(tmp, { recursive: true });

    // Render all caption strips in one browser session; each strip is a transparent page whose
    // only painted element is the bar.
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 64 }, deviceScaleFactor: 1 });

    for (const [name, label] of wanted) {
        const src = join(SHOTS, `${name}.png`);
        if (!existsSync(src)) {
            console.error(`  SKIP  missing ${src}`);
            continue;
        }
        await page.setContent(captionHtml(label));
        const strip = join(tmp, `${name}-strip.png`);
        await page.screenshot({ path: strip, omitBackground: true });

        const out = join(OUT, `${name}.png`);
        // format=auto on overlay is load-bearing: naming a pixel format explicitly drops the
        // PNG alpha or the base plane, which previously produced an all-black frame.
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
            '-i', src, '-i', strip,
            '-filter_complex',
            `[0:v]scale=${WIDTH}:-1:flags=lanczos,format=rgba[b];`
            + `[1:v]scale=${WIDTH}:-1:flags=lanczos,format=rgba[c];`
            + `[b][c]overlay=0:H-h:format=auto[o]`,
            '-map', '[o]', '-frames:v', '1', out], { maxBuffer: 1 << 28 });
        console.log(`  ok    ${out}  <-  ${label}`);
    }

    await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
