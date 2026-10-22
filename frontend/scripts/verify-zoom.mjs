// Throwaway: proves the Health chart interactions work with genuine mouse input.
//
// Drags across the first chart's plot, checks the selection overlay and the stats line
// react, clicks "Zoom in" and checks the scope text, then double-clicks and checks it
// went back to the whole range. Uses CDP mouse events, which is what a person produces.
//
//   node scripts/verify-zoom.mjs http://localhost:5173 "/health?days=20000"
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [base, path] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const profileRoot = join(homedir(), "garmin-work", "chrome-profiles");
mkdirSync(profileRoot, { recursive: true });
const profile = mkdtempSync(join(profileRoot, "z-"));

const chrome = spawn(
  "chromium-browser",
  [
    "--headless",
    "--no-sandbox",
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--remote-debugging-port=${port}`,
    "--window-size=1280,1400",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cleaned = false;
function cleanUp() {
  if (cleaned) return;
  cleaned = true;
  chrome.kill();
  // Chromium rewrites the profile as it exits; retry rather than strand the directory.
  const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (let i = 0; i < 25; i++) {
    rmSync(profile, { recursive: true, force: true });
    if (!existsSync(profile)) return;
    wait(100);
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    cleanUp();
    process.exit(130);
  });
}

try {
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      /* not listening yet */
    }
  }
  if (!target) throw new Error("Chromium did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result ?? m.error);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `${base}${path}` });
  await sleep(9000);

  const evaluate = async (expression) => {
    const out = await send("Runtime.evaluate", { expression, returnByValue: true });
    return out?.result?.value;
  };
  const plotBox = `(() => {
    const el = document.querySelector('[data-testid="health-chart-plot"]');
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`;
  const scope = `(() => {
    const el = document.querySelector('[data-testid="health-chart-plot"]');
    return el?.closest("figure")?.querySelector("dl")?.previousElementSibling?.textContent ?? null;
  })()`;
  const hasOverlay = `!!document.querySelector('[data-testid="health-chart-selection"]')`;
  const clickByText = (text) => `(() => {
    const b = [...document.querySelectorAll("figure button")].find((x) => x.textContent === ${JSON.stringify(text)});
    if (!b) return false;
    b.click();
    return true;
  })()`;

  let box = null;
  for (let i = 0; i < 20 && !box; i++) {
    box = await evaluate(plotBox);
    if (!box) await sleep(1000);
  }
  if (!box) throw new Error("no Health chart plot found");
  await sleep(500);
  box = await evaluate(plotBox);

  const mouse = (type, x, y, extra = {}) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      ...extra,
    });
  const y = box.top + box.height / 2;
  const x0 = box.left + 44 + (box.width - 100) * 0.3;
  const x1 = box.left + 44 + (box.width - 100) * 0.6;

  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
  };

  const scopeBefore = await evaluate(scope);
  check("starts on the whole range", scopeBefore === "Whole range", scopeBefore);

  await mouse("mousePressed", x0, y);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", x0 + ((x1 - x0) * i) / 8, y);
    await sleep(60);
  }
  await mouse("mouseReleased", x1, y);
  await sleep(400);
  const scopeSelected = await evaluate(scope);
  check("a drag selects a range", String(scopeSelected).startsWith("Selected"), scopeSelected);
  check("the selection is drawn over the plot", await evaluate(hasOverlay));

  check("Zoom in is offered", await evaluate(clickByText("Zoom in")));
  await sleep(800);
  const scopeZoomed = await evaluate(scope);
  check("zooming narrows the chart", String(scopeZoomed).startsWith("Zoomed to"), scopeZoomed);
  check("the overlay is gone after zooming", !(await evaluate(hasOverlay)));

  await mouse("mousePressed", x0, y, { clickCount: 2 });
  await mouse("mouseReleased", x0, y, { clickCount: 2 });
  await mouse("mousePressed", x0, y, { clickCount: 2 });
  await mouse("mouseReleased", x0, y, { clickCount: 2 });
  await sleep(800);
  const scopeReset = await evaluate(scope);
  check("a double-click resets the chart", scopeReset === "Whole range", scopeReset);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot?.data) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(homedir(), "zoom-after.png"), Buffer.from(shot.data, "base64"));
  }
  process.exitCode = results.every(Boolean) ? 0 : 1;
} finally {
  cleanUp();
}
