#!/usr/bin/env node
/**
 * Screenshot-interface demo: drive the browser MCP server's screenshot tools for real and let
 * the tool itself write every frame into the repository, then stitch those frames into a GIF.
 *
 * Why this script exists separately from capture-assets.mjs: that one captures with Playwright
 * directly, so its images prove "a browser can render this". Here every image is produced by a
 * genuine tools/call to browser_page_screenshot_for_llm / browser_element_screenshot_for_llm,
 * which is the contract an agent uses — the artifact and the capability are the same evidence.
 *
 * The screenshots arrive through the interface's own `filePath` parameter, so the demo also
 * exercises it: parent directories are created by the server, and each returned
 * { filePath, fileSize } is verified against the file on disk. Nothing here copies a screenshot
 * out of the server temp dir; the tool writes straight to its final home.
 *
 * Frames land in assets/demo-shots/ (committed), so the README can reference them by relative
 * path and a reviewer can diff them.
 *
 * Usage:
 *   node scripts/screenshot-demo.mjs                 # default page
 *   node scripts/screenshot-demo.mjs --url <page>    # another page
 * Requires: x-browser daemon running (x-browser --daemon start).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'assets');
const SHOTS = join(ASSETS, 'demo-shots');
const STEPS = join(SHOTS, 'steps.json');
const CALLS = join(SHOTS, 'calls.jsonl');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 ? argv[i + 1] : fallback;
};
const MCP_URL = flag('url', process.env.X_BROWSER_MCP_URL || 'http://127.0.0.1:3007/mcp');
const PAGE = flag('page', 'https://en.wikipedia.org/wiki/Model_Context_Protocol');

/** Dwell so a viewer can read the caption and see the page react. */
const BEAT_MS = 2600;
const beat = (ms = BEAT_MS) => new Promise((r) => setTimeout(r, ms));

/** jpeg magic bytes: proves the persisted file is an image, not base64 text or a stub. */
const JPEG_MAGIC = 'ffd8ff';

/**
 * Read an image's pixel dimensions with ffprobe.
 *
 * @param {string} file - image path
 * @returns {{width: number, height: number}|null} dimensions, or null if ffprobe is unavailable
 */
function probeSize(file) {
    try {
        const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
        const [width, height] = out.trim().split(',').map(Number);
        return width && height ? { width, height } : null;
    } catch {
        return null;
    }
}

async function main() {
    const client = new Client({ name: 'x-agint-screenshot-demo', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));

    // Real discovery, so the demo cannot call a tool this server does not expose.
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    console.log(`connected ${MCP_URL} - ${tools.length} tools`);

    mkdirSync(SHOTS, { recursive: true });

    /**
     * Call one tool and return its business payload.
     *
     * @param {string} tool - MCP tool name, called exactly as an agent calls it
     * @param {object} args - real arguments
     * @returns {Promise<object|null>} structured payload, or null on error
     */
    const call = async (tool, args) => {
        const at = Date.now();
        const r = await client.callTool({ name: tool, arguments: args });
        const ok = !r.isError;
        console.log(`${new Date(at).toISOString()}  ${ok ? 'ok  ' : 'FAIL'} ${tool}`);
        if (!ok) {
            throw new Error(`${tool} failed: ${(r.content ?? []).map((c) => c.text ?? '').join(' ')}`);
        }
        return r.structuredContent?.result ?? r.structuredContent ?? null;
    };

    /**
     * Take a screenshot through the interface and verify what it wrote.
     *
     * The tool returns { filePath, fileSize }; this asserts the file exists, is non-empty,
     * really starts with jpeg magic, and matches the reported size — so a GIF frame can never
     * be built from a file the server did not actually produce. `name` is only used to pick a
     * stable repo-relative file name; the path handed to the tool is absolute because the
     * interface refuses relative ones.
     *
     * @param {string} tool - screenshot tool name
     * @param {object} args - arguments minus filePath
     * @param {string} name - file name inside assets/demo-shots/
     * @param {string} label - caption text for the GIF frame
     * @returns {Promise<{image: string, tool: string, label: string, fileSize: number}>}
     */
    const shot = async (tool, args, name, label) => {
        const target = join(SHOTS, name);
        const payload = await call(tool, { ...args, filePath: target });
        const reported = payload?.extras ?? payload;
        if (!reported?.filePath) {
            throw new Error(`${tool} returned no filePath: ${JSON.stringify(payload).slice(0, 200)}`);
        }
        if (reported.filePath !== target) {
            throw new Error(`${tool} wrote elsewhere: ${reported.filePath} != ${target}`);
        }
        if (!existsSync(target)) {
            throw new Error(`${tool} reported ${target} but it is not on disk`);
        }
        const bytes = statSync(target).size;
        if (bytes !== reported.fileSize) {
            throw new Error(`${tool}: fileSize ${reported.fileSize} != on-disk ${bytes}`);
        }
        const magic = readFileSync(target).subarray(0, 3).toString('hex');
        if (magic !== JPEG_MAGIC) {
            throw new Error(`${target} is not jpeg (magic ${magic})`);
        }
        // Reject a frame too small to be a demo: a crop of an icon or a collapsed node passes
        // every other check yet renders as a blank smudge in the GIF. Dimensions come from
        // ffprobe, which make-gif.mjs already depends on.
        const dims = probeSize(target);
        if (dims && (dims.width < 200 || dims.height < 120)) {
            throw new Error(`${name} is only ${dims.width}x${dims.height} - too small for a frame; `
                + 'pass --element-text to target a larger node');
        }
        console.log(`     -> ${name} (${bytes} bytes, jpeg verified)`);
        return { image: name, tool, label, fileSize: bytes };
    };

    const required = ['browser_page_open', 'browser_page_search', 'browser_get_viewport_content',
        'browser_page_scroll', 'browser_page_screenshot_for_llm',
        'browser_element_screenshot_for_llm', 'browser_page_close'];
    const missing = required.filter((t) => !names.has(t));
    if (missing.length) throw new Error(`server does not expose: ${missing.join(', ')}`);

    console.log(`page ${PAGE}`);
    const opened = await call('browser_page_open', { url: PAGE });
    const id = opened?.id ?? opened?.pages?.[0]?.id;
    if (!id) throw new Error(`no page id in open result: ${JSON.stringify(opened).slice(0, 200)}`);
    console.log(`     page ${id}`);
    await beat();

    // Pick the element to crop by searching for real page text, not by taking the first
    // indexed node. Measured: the first index on Wikipedia is a 40x88 logo, which makes a
    // useless demo frame; and hard-coding an index breaks the moment the site changes markup.
    // `--element-text` lets the operator retarget this without editing the script.
    const elementText = flag('element-text', 'Model Context Protocol');
    let elementIndex = null;
    const found = await call('browser_page_search', { id, text: elementText, maxResults: 20 });
    const hits = JSON.stringify(found);
    // Prefer the largest-looking hit: an INNERTEXT heading node over a nested span. The tree
    // prints ancestors first, so the shallowest match (fewest leading spaces) is the widest.
    const lines = hits.split('\\n');
    let best = null;
    for (const line of lines) {
        const m = line.match(/^(\s*)\[(\d+)\]/);
        if (!m) continue;
        if (!line.toLowerCase().includes(elementText.toLowerCase()) && !line.includes('INNERTEXT')) continue;
        const depth = m[1].length;
        if (!best || depth < best.depth) best = { index: Number(m[2]), depth };
    }
    if (best) elementIndex = best.index;

    const frames = [];

    // 1. Whole viewport, no index - the interface's default framing.
    frames.push(await shot('browser_page_screenshot_for_llm', { id },
        'shot-01-viewport.jpg', 'browser_page_screenshot_for_llm'));
    await beat();

    // 2. One element, located from what the page actually returned.
    if (elementIndex !== null) {
        frames.push(await shot('browser_element_screenshot_for_llm', { id, index: elementIndex },
            'shot-02-element.jpg', `browser_element_screenshot_for_llm [${elementIndex}]`));
        await beat();
    } else {
        console.log(`     (no node matching "${elementText}"; skipping the element shot)`);
    }

    // 3. Same viewport tool after a scroll - shows the page state changed between frames.
    await call('browser_page_scroll', { id, yDirection: 'down' });
    await beat();
    frames.push(await shot('browser_page_screenshot_for_llm', { id },
        'shot-03-scrolled.jpg', 'browser_page_scroll + screenshot'));
    await beat();

    await call('browser_page_close', { id });

    // Steps file feeds make-gif.mjs; the JSONL is the honest audit trail of what was called.
    writeFileSync(STEPS, JSON.stringify(frames.map((f) => ({
        image: `../demo-shots/${f.image}`, tool: f.tool,
    })), null, 2) + '\n');
    writeFileSync(CALLS, frames.map((f) => JSON.stringify(f)).join('\n') + '\n');
    console.log(`\nwrote ${frames.length} frames to ${SHOTS}`);
    console.log(`steps -> ${STEPS}`);

    await client.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
