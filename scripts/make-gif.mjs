#!/usr/bin/env node
/**
 * Compose captioned frames and stitch them into a GIF, so a README can show an MCP tool
 * sequence without a video.
 *
 * Why screenshots instead of a screen recording: a full-screen capture records whatever
 * happens to be on the display (including the operator's own windows), which makes it
 * unusable as documentation. Screenshots taken through the browser tools are exactly the
 * region under test, and they are the same images those tools return.
 *
 * Why ffmpeg does not draw the caption: this build has neither libass nor libfreetype
 * (`ffmpeg -filters` lists no `ass`, `subtitles` or `drawtext`). The caption is rendered in
 * a browser on a transparent page and composited with `overlay`, which needs no text filter.
 *
 * Why the GIF is assembled by hand instead of with ffmpeg: feeding still images through
 * `concat` gives each input an image2 default duration, so the frame count and per-frame
 * delay come out wrong (measured: 7 steps produced a 2-second/4-frame GIF, twice). Writing
 * the GIF89a blocks directly makes both exactly controllable and removes ffmpeg from the
 * loop entirely. Only PNG decoding is borrowed — via zlib, which is Node built-in.
 *
 * The caption carries the tool name only; arguments are deliberately left out (too long to
 * read at GIF size, and they belong in prose).
 *
 * Usage:
 *   node scripts/make-gif.mjs --steps steps.json --out assets/demos/browser-session.gif
 * steps.json: [{ "image": "../screenshots/read-01-article.png", "tool": "browser_page_open" }, ...]
 */
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import gifenc from 'gifenc';
// gifenc ships as CommonJS, so its exports arrive on the default import under Node ESM.
const { GIFEncoder, quantize, applyPalette } = gifenc;

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'assets');

/** GIF canvas width: readable in a README while staying far under GitHub's 10 MB limit. */
const WIDTH = 960;
/** Caption strip height, in CSS px. Kept short so it covers as little page as possible. */
const BAR_HEIGHT = 48;
/** Seconds each frame is shown. */
const FRAME_SECONDS = 2.2;

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
            // playwright's entry is CommonJS: under ESM interop the exports sit on .default.
            return mod.chromium ? mod : mod.default;
        } catch { /* next candidate */ }
    }
    console.error('playwright is not resolvable; set X_AGINT_PLAYWRIGHT to a directory whose\n'
        + 'node_modules contains playwright, or run `npm install playwright` here.');
    process.exit(1);
}

/**
 * One caption strip. The page body is transparent and only the bar is painted, so compositing
 * it over a screenshot keeps every pixel of the screenshot outside the bar.
 *
 * The bar itself is translucent: an opaque strip hid the bottom row of the page under it (the
 * player bar, the last table rows). A gradient plus a text shadow keeps the label readable on
 * both light and dark pages without turning the strip back into a solid block.
 */
function captionHtml(tool) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:transparent;font-family:Menlo,monospace}
      .bar{width:${WIDTH}px;height:${BAR_HEIGHT}px;box-sizing:border-box;
           background:linear-gradient(to bottom,
               rgba(18,18,26,0.15) 0%, rgba(18,18,26,0.45) 45%, rgba(18,18,26,0.72) 100%);
           border-top:3px solid rgba(47,111,235,0.85);
           display:flex;align-items:center;padding:0 18px}
      .mcp{font-size:13px;color:#7fd18a;margin-right:10px;
           text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.9)}
      .tool{font-size:26px;font-weight:700;color:#fff;letter-spacing:.3px;
            text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 2px rgba(0,0,0,.95)}
    </style></head><body>
      <div class="bar"><span class="mcp">MCP</span><span class="tool">${escapeHtml(tool)}</span></div>
    </body></html>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/** ffmpeg is used only for what it does well here: scale a PNG and blend alpha. */
function runFFmpeg(args) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args],
        { maxBuffer: 1 << 28 });
}

/**
 * Composite one frame: scale the screenshot to WIDTH, paste its caption strip along the
 * bottom edge. `format=auto` on overlay is load-bearing — naming gbrp/yuv explicitly drops
 * either the PNG alpha or the base plane, which rendered as a fully black frame.
 */
function composite(screenshot, caption, out) {
    runFFmpeg(['-i', screenshot, '-i', caption,
        '-filter_complex',
        `[0:v]scale=${WIDTH}:-1:flags=lanczos,format=rgba[b];`
        + `[1:v]scale=${WIDTH}:-1:flags=lanczos,format=rgba[c];`
        + `[b][c]overlay=0:H-h:format=auto[o]`,
        '-map', '[o]', '-frames:v', '1', out]);
}

// ── GIF assembly ────────────────────────────────────────────────────────────────
// Frames are decoded from the composited PNGs and written through gifenc. An earlier
// revision hand-rolled LZW with literal codewords; ffmpeg rejected its output (decode
// error, zero frames), so the encoder is not reimplemented here.

/** Decode a PNG produced by ffmpeg into RGBA rows.

/**
 * Decode a PNG produced by ffmpeg into RGBA rows. Only the filter types ffmpeg actually
 * emits for rgba output are needed (None / Sub / Up / Paeth), which is all of them anyway.
 */
function decodePng(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
    let pos = 8, width = 0, height = 0, colorType = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const body = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0); height = body.readUInt32BE(4);
            colorType = body[9];
            if (body[8] !== 8) throw new Error('only 8-bit PNG supported');
        } else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        pos += 12 + len;
    }
    if (colorType !== 6) throw new Error(`expected RGBA PNG, got colorType ${colorType}`);
    const raw = inflateSync(Buffer.concat(idat));
    const bpp = 4, stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    let rp = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[rp++];
        const line = raw.subarray(rp, rp + stride); rp += stride;
        const cur = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            const c = prev && x >= bpp ? prev[x - bpp] : 0;
            let v = line[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            cur[x] = v & 0xff;
        }
    }
    return { width, height, rgba: out };
}

/**
 * Write the frames as one looping GIF. The palette is computed per frame (gifenc's
 * quantizer) rather than shared, which costs a few KiB and avoids the banding a single
 * 256-colour table produces across screenshots of different pages.
 */
function writeGif(path, frames) {
    const gif = GIFEncoder();
    const delayMs = Math.round(FRAME_SECONDS * 1000);
    for (const f of frames) {
        const palette = quantize(f.rgba, 256, { format: 'rgb444' });
        const index = applyPalette(f.rgba, palette, 'rgb444');
        gif.writeFrame(index, f.width, f.height, { palette, delay: delayMs });
    }
    gif.finish();
    writeFileSync(path, gif.bytes());
}

async function main() {
    const argv = process.argv.slice(2);
    const flag = (n, f) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : f; };
    const stepsPath = resolve(flag('steps', join(ASSETS, 'demos', 'gif-steps.json')));
    const out = resolve(flag('out', join(ASSETS, 'demos', 'browser-session.gif')));
    if (!existsSync(stepsPath)) { console.error(`no steps file at ${stepsPath}`); process.exit(1); }
    const steps = JSON.parse(readFileSync(stepsPath, 'utf8'));

    const work = join(ASSETS, 'demos', '.gif-work');
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });

    // One caption strip per distinct tool name; reusing them avoids re-rendering text.
    const capPaths = await renderCaptions([...new Set(steps.map((s) => s.tool))], work);

    const frames = [];
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const img = resolve(dirname(stepsPath), s.image);
        if (!existsSync(img)) { console.error(`missing screenshot: ${img}`); process.exit(1); }
        const comp = join(work, `frame-${String(i).padStart(2, '0')}.png`);
        composite(img, capPaths[s.tool], comp);
        const { width, height, rgba } = decodePng(readFileSync(comp));
        if (width !== WIDTH) { console.error(`frame ${i} scaled to ${width}, expected ${WIDTH}`); process.exit(1); }
        frames.push({ width, height, rgba });
    }

    writeGif(out, frames);
    rmSync(work, { recursive: true, force: true });
    const bytes = readFileSync(out).length;
    console.log(`${out}  ${frames.length} frames @ ${FRAME_SECONDS}s  ${(bytes / 1024).toFixed(0)} KiB`);
}

/** Render one transparent caption PNG per distinct tool name. */
async function renderCaptions(tools, outDir) {
    const { chromium } = await loadPlaywright();
    const profile = join(outDir, '.cap-profile');
    rmSync(profile, { recursive: true, force: true });
    const context = await chromium.launchPersistentContext(profile, {
        headless: true, viewport: { width: WIDTH, height: BAR_HEIGHT }, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const paths = {};
    for (const tool of tools) {
        await page.setContent(captionHtml(tool), { waitUntil: 'load' });
        // omitBackground keeps the page body transparent, so only the bar is painted.
        await page.screenshot({ path: join(outDir, `cap-${tool}.png`), omitBackground: true });
        paths[tool] = join(outDir, `cap-${tool}.png`);
    }
    await context.close();
    rmSync(profile, { recursive: true, force: true });
    return paths;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
