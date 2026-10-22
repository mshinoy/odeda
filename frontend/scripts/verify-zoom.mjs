// Throwaway: proves a real mouse drag on the zoom slider changes the window.
//
// The screenshot script can click but not drag, so "the slider renders" was as far as
// verification went — and this exact feature already shipped once doing nothing at all
// (DataZoomComponent was never registered, which ECharts ignores in silence). This
// dispatches genuine CDP mouse events and reads ECharts' own dataZoom state either side.
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

  // ECharts is imported from `echarts/core`, so there is no `window.echarts` to ask
  // for the instance. Compare what is *drawn* instead: the plot area only, cropped
  // above the slider strip, so a handle sliding along cannot pass for a zoom on its
  // own. If the window changed, the line under it is drawn differently.
  const SLIDER_STRIP = 40;
  const locate = `(() => {
    const c = [...document.querySelectorAll("canvas")]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(x => x.r.width > 300 && x.r.height > 120)[0];
    if (!c) return null;
    c.el.dataset.zoomProbe = "1";
    return { left: c.r.left, top: c.r.top, width: c.r.width, height: c.r.height };
  })()`;

  /** The plot area as a PNG string, with the slider strip cropped off. */
  const plotPixels = `(() => {
    const el = document.querySelector("canvas[data-zoom-probe]");
    if (!el) return null;
    const h = el.height - ${SLIDER_STRIP} * (el.height / el.getBoundingClientRect().height);
    const off = document.createElement("canvas");
    off.width = el.width; off.height = Math.max(1, Math.round(h));
    off.getContext("2d").drawImage(el, 0, 0);
    return off.toDataURL().length + ":" + off.toDataURL().slice(-220);
  })()`;

  let before = await evaluate(locate);
  if (!before) {
    // Give a slow window (two large requests) longer before giving up, then say what
    // was actually on the page rather than just that nothing matched.
    await sleep(8000);
    before = await evaluate(locate);
  }
  if (!before) {
    const seen = await evaluate(`(() => ({
      title: document.title,
      text: document.body.innerText.slice(0, 160),
      canvases: [...document.querySelectorAll("canvas")].map(c => {
        const r = c.getBoundingClientRect();
        return Math.round(r.width) + "x" + Math.round(r.height);
      }),
    }))()`);
    throw new Error(`no chart canvas found. page: ${JSON.stringify(seen)}`);
  }
  const pixelsBefore = await evaluate(plotPixels);

  // The slider sits at the bottom of the chart box. Its track is NOT aligned to the
  // grid's gutters: ECharts lays the slider out with its own margins, measured at ~57
  // left and ~54 right. A drag at the grid's 44 lands on blank canvas and does
  // nothing, which is exactly how this test failed the first time.
  const SLIDER_INSET_LEFT = 57;
  const SLIDER_INSET_RIGHT = 54;
  const sliderY = before.top + before.height - 11;
  const trackLeft = before.left + SLIDER_INSET_LEFT;
  const trackRight = before.left + before.width - SLIDER_INSET_RIGHT;
  // A few pixels in, so the press lands on the handle rather than beside it.
  const handleX = trackLeft + 3;
  const dropX = trackLeft + (trackRight - trackLeft) * 0.45;

  const mouse = (type, x, y) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
    });

  await mouse("mousePressed", handleX, sliderY);
  // Several moves: ECharts throttles, and one jump can be swallowed.
  for (let i = 1; i <= 6; i++) {
    await mouse("mouseMoved", handleX + ((dropX - handleX) * i) / 6, sliderY);
    await sleep(80);
  }
  await mouse("mouseReleased", dropX, sliderY);
  await sleep(1200);

  const pixelsAfter = await evaluate(plotPixels);
  const moved = pixelsBefore !== pixelsAfter;

  // A picture of the result, so a failure can be read rather than guessed at: if the
  // handle has not moved, the drag missed it and the harness is at fault, not the app.
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot?.data) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(homedir(), "zoom-after.png"), Buffer.from(shot.data, "base64"));
    console.log(`  wrote ~/zoom-after.png`);
  }
  console.log(
    `  canvas box : ${Math.round(before.left)},${Math.round(before.top)} ` +
      `${Math.round(before.width)}x${Math.round(before.height)}  sliderY ${Math.round(sliderY)}`,
  );

  console.log(`  dragged the left handle ${Math.round(handleX)}px -> ${Math.round(dropX)}px`);
  console.log(`  plot before : ${String(pixelsBefore).slice(0, 48)}…`);
  console.log(`  plot after  : ${String(pixelsAfter).slice(0, 48)}…`);
  console.log(
    moved
      ? "  RESULT : the plot redrew — the drag changed the window"
      : "  RESULT : the plot is identical — the drag did nothing",
  );
  process.exitCode = moved ? 0 : 1;
} finally {
  cleanUp();
}
