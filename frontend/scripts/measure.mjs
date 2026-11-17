// Times a page of the running app in headless Chromium: how long it takes to be
// usable, what it downloaded to get there, and what a hover costs per frame.
//
//   node scripts/measure.mjs <baseUrl> <path> [--hover=<css selector>] [--wait=9000]
//                            [--frames=60] [--width=1280] [--height=1300]
//   e.g. node scripts/measure.mjs http://localhost:5173 /activities/90000000004 \
//          --hover='canvas'
//
// --hover moves the pointer back and forth across the element and reports the frame
// interval Chromium actually achieved, which is the number the 16 ms budget is about.
//
// **On a box with no GPU this measures SwiftShader, not the app.** A WebGL map costs
// the same per frame here whether it carries a layer or nothing at all, so a map
// number from this script is a floor, not a measurement. A 2D-canvas chart (ECharts)
// is CPU-bound either way and its number is real.
//
// If the app has a password, pass it as GA_PASSWORD. Needs chromium-browser on PATH.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const flagValue = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

const [base, path] = positional;
if (!base || !path) {
  console.error("usage: node scripts/measure.mjs <baseUrl> <path> [--hover=<selector>]");
  process.exit(2);
}
const hoverSelector = flags.find((f) => f.startsWith("--hover="))?.slice("--hover=".length);
const width = flagValue("width", 1280);
const height = flagValue("height", 1300);
const waitMs = flagValue("wait", 9000);
const frames = flagValue("frames", 60);
const password = process.env.GA_PASSWORD ?? "";
const port = 9800 + Math.floor(Math.random() * 150);

const profileRoot = join(homedir(), "garmin-work", "chrome-profiles");
mkdirSync(profileRoot, { recursive: true });
const profile = mkdtempSync(join(profileRoot, "m-"));
const chrome = spawn(
  "chromium-browser",
  [
    "--headless",
    "--no-sandbox",
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let cleanedUp = false;
function cleanUp() {
  if (cleanedUp) return;
  cleanedUp = true;
  chrome.kill();
  for (let attempt = 0; attempt < 20; attempt++) {
    rmSync(profile, { recursive: true, force: true });
    if (!existsSync(profile)) return;
    sleepSync(100);
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanUp();
    process.exit(130);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

try {
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      // Chromium not listening yet.
    }
  }
  if (!target) throw new Error("Chromium did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  let nextId = 0;
  const pending = new Map();
  /** Transfer size per response, by resource type, for the download breakdown. */
  const transfers = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result ?? msg.error);
    if (msg.method === "Network.loadingFinished") {
      transfers.push(msg.params.encodedDataLength ?? 0);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Network.enable");
  await send("Runtime.enable");
  if (password) {
    await send("Page.navigate", { url: `${base}/login` });
    await sleep(2000);
    await send("Runtime.evaluate", {
      expression: `fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: ${JSON.stringify(password)} }) })`,
      awaitPromise: true,
    });
    transfers.length = 0;
  }

  const startedAt = Date.now();
  await send("Page.navigate", { url: `${base}${path}` });
  await sleep(waitMs);

  const { result: timing } = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      dom: Math.round(performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? 0),
      paint: Math.round(performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? 0),
      resources: performance.getEntriesByType("resource").length,
    })`,
  });

  console.log(`PATH        ${path}`);
  console.log(`WALL        ${Date.now() - startedAt} ms to settle (includes the fixed wait)`);
  const marks = JSON.parse(timing.value);
  console.log(`FCP         ${marks.paint} ms`);
  console.log(`DOM READY   ${marks.dom} ms`);
  console.log(
    `DOWNLOADED  ${kb(transfers.reduce((sum, n) => sum + n, 0))} over ${transfers.length} responses`,
  );

  if (hoverSelector) {
    const { result: box } = await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(hoverSelector)});
        if (!el) return "null";
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      })()`,
    });
    if (box.value === "null") {
      console.log(`HOVER       no element matches ${hoverSelector}`);
    } else {
      const rect = JSON.parse(box.value);
      const y = rect.y + Math.round(rect.h / 2);
      const started = Date.now();
      for (let i = 0; i < frames; i++) {
        // Back and forth, so every move is a new x and the crosshair really redraws.
        const t = i / (frames - 1);
        const x = rect.x + Math.round(rect.w * (t < 0.5 ? t * 2 : 2 - t * 2));
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
      }
      // Wait for the last frame to land before stopping the clock.
      await send("Runtime.evaluate", {
        expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
        awaitPromise: true,
      });
      const perMove = (Date.now() - started) / frames;
      console.log(
        `HOVER       ${perMove.toFixed(1)} ms per move over ${frames} moves on ${hoverSelector}` +
          ` (${rect.w}×${rect.h})`,
      );
    }
  }
} finally {
  cleanUp();
}
process.exit(0);
