// End-to-end smoke test against the production build, using the locally installed Chrome.
// Usage: npm run build && npm run smoke   (CHROME_PATH overrides the browser executable)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts", "out");
mkdirSync(outDir, { recursive: true });
const PORT = 3123;
const URL = `http://localhost:${PORT}`;

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error("No Chrome/Edge found; set CHROME_PATH");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Server did not start");
}

const server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
  cwd: root,
  stdio: "ignore",
});

let browser;
try {
  await waitForServer(URL);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

  await page.goto(URL);
  await page.getByTestId("dropzone").waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="dropzone"]');
    return el && Number(getComputedStyle(el).opacity) > 0.99;
  }, null, { timeout: 5000 });
  await page.screenshot({ path: path.join(outDir, "01-empty.png") });
  check("empty state renders (fade-in completes)", true);

  // Synthesize a 1800x1200 test photo: sharp textured background, blurred colourful subject.
  const dataUrl = await page.evaluate(async () => {
    const W = 1800, H = 1200;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = "#6b7280"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 500; i++) {
      const v = 70 + Math.floor(rnd() * 90);
      g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      g.fillRect(rnd() * W, rnd() * H, 8 + rnd() * 90, 8 + rnd() * 90);
    }
    g.fillStyle = "#e5e7eb"; g.font = "28px sans-serif";
    for (let y = 40; y < H; y += 120) g.fillText("SHARP BACKGROUND TEXTURE 0123456789", 30, y);
    // Subject, drawn sharp on its own layer, then blurred (simulated missed focus).
    const sub = document.createElement("canvas");
    sub.width = W; sub.height = H;
    const sg = sub.getContext("2d");
    sg.save();
    sg.beginPath(); sg.ellipse(900, 600, 300, 380, 0, 0, Math.PI * 2); sg.clip();
    sg.fillStyle = "#d97706"; sg.fillRect(0, 0, W, H);
    for (let x = 560; x < 1240; x += 26) { sg.fillStyle = "#7c2d12"; sg.fillRect(x, 200, 9, 800); }
    sg.fillStyle = "#fde68a"; sg.font = "bold 64px sans-serif"; sg.fillText("FOCUS", 760, 620);
    sg.restore();
    g.filter = "blur(4px)";
    g.drawImage(sub, 0, 0);
    g.filter = "none";
    return c.toDataURL("image/png");
  });
  const pngBuf = Buffer.from(dataUrl.split(",")[1], "base64");
  writeFileSync(path.join(outDir, "input.png"), pngBuf);

  const t0 = Date.now();
  await page.getByTestId("file-input").setInputFiles({ name: "blurry-subject.png", mimeType: "image/png", buffer: pngBuf });
  await page.getByTestId("file-meta").waitFor({ timeout: 20000 });
  const meta = await page.getByTestId("file-meta").innerText();
  check("file metadata shows resolution and aspect", meta.includes("1800 × 1200") && meta.includes("3:2"), meta.replace(/\s+/g, " "));

  // Upload auto-runs soft-focus detection and then a live enhancement.
  await page.getByTestId("analysis").waitFor({ timeout: 60000 });
  const firstRun = Date.now() - t0;
  const analysis = await page.getByTestId("analysis").innerText();
  check("auto-detect + enhance produce analysis", true, `${firstRun} ms, ${analysis.replace(/\s+/g, " ")}`);
  const sigmaMatch = analysis.match(/([\d.]+)\s*px/);
  const sigma = sigmaMatch ? Number(sigmaMatch[1]) : NaN;
  // Canvas blur(4px) uses sigma = 4 px.
  check("estimated blur radius is plausible for blur(4px)", sigma > 2.5 && sigma < 6, `sigma=${sigma}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "02-split.png") });

  // Split handle drag.
  const vp = await page.getByTestId("viewport").boundingBox();
  const handle = page.getByTestId("split-handle");
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width * 0.3, vp.y + vp.height / 2, { steps: 5 });
  await page.mouse.up();
  const splitVal = Number(await handle.getAttribute("aria-valuenow"));
  check("split divider drags", Math.abs(splitVal - 30) <= 2, `aria-valuenow=${splitVal}`);

  // Side-by-side compare.
  await page.getByTestId("seg-side").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, "03-side.png") });
  check("side-by-side mode", (await page.getByTestId("split-handle").count()) === 0);
  await page.getByTestId("seg-split").click();

  // Zoom via wheel.
  const zoomBefore = await page.getByTestId("zoom").innerText();
  await page.mouse.move(vp.x + vp.width * 0.5, vp.y + vp.height * 0.5);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  const zoomAfter = await page.getByTestId("zoom").innerText();
  check("wheel zoom", parseInt(zoomAfter) > parseInt(zoomBefore), `${zoomBefore} -> ${zoomAfter}`);
  await page.screenshot({ path: path.join(outDir, "04-zoomed.png") });
  await page.keyboard.press("0");

  // Slider keyboard control re-runs enhancement.
  const deblurThumb = page.getByTestId("slider-deblur").getByRole("slider");
  await deblurThumb.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  const deblurVal = await page.getByTestId("slider-deblur-value").innerText();
  check("deblur slider responds", deblurVal === "80%", deblurVal);
  await page.getByTestId("status").filter({ hasText: "Up to date" }).waitFor({ timeout: 30000 });
  check("live preview re-runs after slider change", true);

  // Brush stroke + undo.
  await page.keyboard.press("b");
  const undoBtn = page.getByRole("button", { name: "Undo" });
  await page.mouse.move(vp.x + vp.width * 0.15, vp.y + vp.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width * 0.25, vp.y + vp.height * 0.25, { steps: 8 });
  await page.mouse.up();
  check("brush stroke enables undo", await undoBtn.isEnabled());
  await page.keyboard.press("Control+z");
  await page.getByTestId("status").filter({ hasText: "Up to date" }).waitFor({ timeout: 30000 });
  check("undo restores and re-enhances", true);

  // Box tool: clear then draw a box around the subject.
  await page.getByTestId("clear-mask").click();
  await page.getByTestId("status").filter({ hasText: "No enhancement yet" }).waitFor({ timeout: 10000 });
  check("clear mask removes result", true);
  await page.keyboard.press("m");
  // Image fit: compute subject box in screen space from image coords (600..1200, 220..980).
  const fitScale = Math.min((vp.width - 64) / 1800, (vp.height - 64) / 1200);
  const ox = vp.x + (vp.width - 1800 * fitScale) / 2;
  const oy = vp.y + (vp.height - 1200 * fitScale) / 2;
  await page.mouse.move(ox + 600 * fitScale, oy + 220 * fitScale);
  await page.mouse.down();
  await page.mouse.move(ox + 1200 * fitScale, oy + 980 * fitScale, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId("status").filter({ hasText: "Up to date" }).waitFor({ timeout: 30000 });
  check("box selection triggers enhancement", true);
  await page.screenshot({ path: path.join(outDir, "05-box.png") });

  // Export and verify pixels.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-btn").click()]);
  const exportPath = path.join(outDir, "export.png");
  await download.saveAs(exportPath);
  check("export downloads a file", download.suggestedFilename() === "blurry-subject-enhanced.png", download.suggestedFilename());
  const { readFileSync } = await import("node:fs");
  const exportUrl = "data:image/png;base64," + readFileSync(exportPath).toString("base64");

  const metrics = await page.evaluate(
    async ([a, b]) => {
      const load = async (u) => {
        const img = new Image();
        img.src = u;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const A = await load(a);
      const B = await load(b);
      const W = A.width;
      const lap = (d, x0, y0, x1, y1) => {
        let s = 0, n = 0;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const v = 4 * d[i + 1] - d[i + 1 - 4] - d[i + 1 + 4] - d[i + 1 - W * 4] - d[i + 1 + W * 4];
            s += v * v; n++;
          }
        return s / n;
      };
      let outsideDiff = 0;
      let outsideN = 0;
      for (let y = 0; y < A.height; y++)
        for (let x = 0; x < W; x++) {
          const inBox = x >= 520 && x < 1280 && y >= 140 && y < 1060;
          if (inBox) continue;
          const i = (y * W + x) * 4;
          outsideN++;
          if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) outsideDiff++;
        }
      // Sharp background inside the box but outside the blurred ellipse (box corners).
      let cornerDiff = 0, cornerN = 0;
      for (const [x0, y0] of [[610, 230], [1100, 230], [610, 880], [1100, 880]])
        for (let y = y0; y < y0 + 90; y++)
          for (let x = x0; x < x0 + 90; x++) {
            const i = (y * W + x) * 4;
            cornerDiff += Math.abs(A.data[i + 1] - B.data[i + 1]);
            cornerN++;
          }
      return {
        w: B.width, h: B.height,
        lapBefore: lap(A.data, 700, 300, 1100, 900),
        lapAfter: lap(B.data, 700, 300, 1100, 900),
        outsideDiff, outsideN,
        cornerMeanDiff: cornerDiff / cornerN,
      };
    },
    [dataUrl, exportUrl],
  );
  check("export is full resolution", metrics.w === 1800 && metrics.h === 1200, `${metrics.w}x${metrics.h}`);
  const gain = metrics.lapAfter / metrics.lapBefore;
  check("subject sharpness increased", gain > 1.5, `laplacian energy x${gain.toFixed(2)}`);
  check("pixels outside mask+feather unchanged", metrics.outsideDiff === 0, `${metrics.outsideDiff}/${metrics.outsideN} differ`);
  check("already-sharp detail inside mask is left alone (no halos)", metrics.cornerMeanDiff < 2, `mean |Δ| = ${metrics.cornerMeanDiff.toFixed(2)} levels`);

  // ---------- Absurdly high enhancement ----------
  const deblurSlider = page.getByTestId("slider-deblur").getByRole("slider");
  check("normal mode caps deblur at 100", (await deblurSlider.getAttribute("aria-valuemax")) === "100");
  await page.getByTestId("extreme-toggle").click();
  check("extreme mode raises the cap to 300", (await deblurSlider.getAttribute("aria-valuemax")) === "300");
  await deblurSlider.focus();
  await page.keyboard.press("End");
  const extremeVal = await page.getByTestId("slider-deblur-value").innerText();
  check("deblur can go to 300%", extremeVal === "300%", extremeVal);
  await page.getByTestId("status").filter({ hasText: "Up to date" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, "07-extreme.png") });
  const [dlX] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-btn").click()]);
  const extremePath = path.join(outDir, "export-extreme.png");
  await dlX.saveAs(extremePath);
  const extremeLap = await page.evaluate(async ([a, b]) => {
    const load = async (u) => {
      const img = new Image(); img.src = u; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height);
    };
    const lap = (D) => {
      const d = D.data, W = D.width; let s = 0, n = 0;
      for (let y = 300; y < 900; y++) for (let x = 700; x < 1100; x++) {
        const i = (y * W + x) * 4 + 1;
        const v = 4 * d[i] - d[i - 4] - d[i + 4] - d[i - W * 4] - d[i + W * 4]; s += v * v; n++;
      }
      return s / n;
    };
    return lap(await load(b)) / lap(await load(a));
  }, [exportUrl, "data:image/png;base64," + readFileSync(extremePath).toString("base64")]);
  check("300% extreme is visibly stronger than normal", extremeLap > 1.3, `laplacian energy x${extremeLap.toFixed(2)} vs normal export`);
  await page.getByTestId("extreme-toggle").click();
  const clamped = await page.getByTestId("slider-deblur-value").innerText();
  check("turning extreme off clamps sliders back to 100%", clamped === "100%", clamped);

  // ---------- Compressor ----------
  await page.getByTestId("seg-jpeg").click();
  await page.getByRole("radio", { name: "1280" }).click();
  await page.getByTestId("seg-target").click();
  const targetSlider = page.getByTestId("slider-target").getByRole("slider");
  await targetSlider.focus();
  await page.keyboard.press("Home"); // 50 KB, smallest target
  for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowRight");
  const targetLabel = await page.getByTestId("slider-target-value").innerText();
  await page.waitForFunction(() => document.querySelector('[data-testid="estimate"]')?.textContent?.includes("1280×"), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const estimateText = (await page.getByTestId("estimate").innerText()).replace(/\s+/g, " ");
  check("size estimate shows output size and saving", /1280×853/.test(estimateText) && /vs original/.test(estimateText), estimateText);
  const [dlC] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-panel-btn").click()]);
  const cPath = path.join(outDir, "export-compressed.jpg");
  await dlC.saveAs(cPath);
  const cBytes = readFileSync(cPath).length;
  const parseSize = (t) => {
    const m = t.match(/([\d.]+)\s*(KB|MB|B)/);
    return m ? Number(m[1]) * (m[2] === "MB" ? 1048576 : m[2] === "KB" ? 1024 : 1) : NaN;
  };
  const targetBytes = parseSize(targetLabel);
  const dims = await page.evaluate(async (u) => {
    const img = new Image(); img.src = u; await img.decode(); return [img.width, img.height];
  }, "data:image/jpeg;base64," + readFileSync(cPath).toString("base64"));
  check("compressed export is JPEG with .jpg name", dlC.suggestedFilename() === "blurry-subject-enhanced.jpg", dlC.suggestedFilename());
  check("compressed export resized to 1280 long edge", dims[0] === 1280 && dims[1] === 853, dims.join("x"));
  check("compressed export fits the target size", cBytes <= targetBytes, `${cBytes} B <= target ${targetLabel} (${Math.round(targetBytes)} B)`);
  check("compressed export is much smaller than PNG", cBytes < readFileSync(exportPath).length / 3, `${cBytes} vs ${readFileSync(exportPath).length} B`);
  await page.screenshot({ path: path.join(outDir, "08-compressor.png") });

  await page.keyboard.press("v");
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, "06-final-nomask.png") });

  check("no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  check("smoke run completed", false, String(err?.stack || err));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
