// Screenshots a page of the running app in headless Chromium and prints what rendered,
// plus any console errors and uncaught exceptions. Used to verify a view before commit.
//
//   node scripts/screenshot.mjs <baseUrl> <path> <out.png> [--dark] [--width=1280] [--height=1300]
//                               [--click=<css selector>] [--wait=9000]
//   e.g. node scripts/screenshot.mjs http://localhost:5173 /status ~/status.png --dark
//
// --click clicks every element matching the selector once the page has rendered, e.g.
// --click='[data-slot=collapsible-trigger]' opens the collapsed blocks on an activity.
//
// If the app has a password, pass it as GA_PASSWORD; the script signs in first.
// Needs chromium-browser on PATH. A snap-packaged Chromium cannot write under /tmp, so
// keep <out.png> under $HOME. No npm dependencies: DevTools protocol over Node's WebSocket.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const flagValue = (name, fallback) => {
  const hit = [...flags].find((f) => f.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

const [base, path, out] = positional;
if (!base || !path || !out) {
  console.error("usage: node scripts/screenshot.mjs <baseUrl> <path> <out.png> [--dark]");
  process.exit(2);
}
const dark = flags.has("--dark");
const clickSelector = [...flags].find((f) => f.startsWith("--click="))?.slice("--click=".length);
const width = flagValue("width", 1280);
const height = flagValue("height", 1300);
const password = process.env.GA_PASSWORD ?? "";
// A map page needs longer than a chart page: in dev, Vite transforms deck.gl and the
// map library on the first request for them, which no amount of app speed avoids.
const RENDER_WAIT_MS = flagValue("wait", 9000);
const AFTER_CLICK_WAIT_MS = 2000;
const port = 9300 + Math.floor(Math.random() * 500);

// A fresh profile per run, so tabs from an earlier run are never restored. It lives under
// ~/garmin-work/chrome-profiles, not straight in $HOME: snap-packaged Chromium cannot write
// under /tmp and may not write into hidden folders, but an ordinary visible subdirectory is
// fine — and one parent folder beats stranding 50 loose profiles in the home directory.
const profileRoot = join(homedir(), "garmin-work", "chrome-profiles");
mkdirSync(profileRoot, { recursive: true });
const profile = mkdtempSync(join(profileRoot, "p-"));
const chrome = spawn(
  "chromium-browser",
  [
    "--headless",
    "--no-sandbox",
    "--hide-scrollbars",
    // Software WebGL, so maps render without a GPU.
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

// Chromium keeps rewriting its profile while it shuts down, so deleting straight after
// kill() loses the race and strands the directory — which is how 50 of them accumulated.
// Retry for up to two seconds, and clean up on a signal too, so a killed run leaves nothing.
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
  const problems = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result ?? msg.error);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      problems.push(`EXCEPTION ${d.exception?.description ?? d.text}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map((a) => a.value ?? a.description).join(" ");
      problems.push(`CONSOLE ERROR ${text}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  if (dark) {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
  }

  if (password) {
    await send("Page.navigate", { url: `${base}/login` });
    await sleep(2000);
    await send("Runtime.evaluate", {
      expression: `fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: ${JSON.stringify(password)} }) })`,
      awaitPromise: true,
    });
  }

  await send("Page.navigate", { url: `${base}${path}` });
  await sleep(RENDER_WAIT_MS);

  if (clickSelector) {
    const { result: clicked } = await send("Runtime.evaluate", {
      expression: `(() => { const els = document.querySelectorAll(${JSON.stringify(clickSelector)}); els.forEach((el) => el.click()); return els.length; })()`,
    });
    console.log(`CLICKED ${clicked.value} × ${clickSelector}`);
    await sleep(AFTER_CLICK_WAIT_MS);
  }

  const { result } = await send("Runtime.evaluate", {
    expression:
      "location.pathname + ' | ' + (document.getElementById('root')?.innerText ?? '').slice(0, 600).replace(/\\n+/g, ' · ')",
  });
  console.log(`PAGE ${result.value}`);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`SCREENSHOT ${out}`);
  // Map tokens can appear in error text; never print them.
  for (const line of problems)
    console.log(line.replace(/pk\.[\w.-]+/g, "pk.REDACTED").slice(0, 600));
} finally {
  cleanUp();
}
process.exit(0);
