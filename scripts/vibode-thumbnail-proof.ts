/**
 * Local thumbnail proof harness.
 *
 * Playwright stays outside this package. Install it once with:
 *   mkdir -p /tmp/vibode-thumb-2b-runtime
 *   cd /tmp/vibode-thumb-2b-runtime && npm init -y && npm install playwright
 *   npx playwright install chromium
 *
 * Not a production worker. Artifacts go to /tmp/vibode-thumb-2c.
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import sharp from "sharp";

const OUT_DIR = "/tmp/vibode-thumb-2c";
const PLAYWRIGHT_ROOT = process.env.VIBODE_THUMBNAIL_PLAYWRIGHT_ROOT ||
  "/tmp/vibode-thumb-2b-runtime";

type ReadyState = {
  status?: string;
  jobId?: string | null;
  objectCount?: number;
  error?: { code?: string; message?: string };
  timing?: Record<string, number | null>;
};

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) {
    throw new Error(`Missing ${name}. Usage: npm run vibode:thumbnail-proof -- --room <roomId> --version <versionId>`);
  }
  return value;
}

function loadChromium(): {
  launch: (options: { headless: boolean; args: string[] }) => Promise<{
    newPage: () => Promise<ProofPage>;
    close: () => Promise<void>;
  }>;
} {
  const requireFromRuntime = createRequire(join(PLAYWRIGHT_ROOT, "package.json"));
  return requireFromRuntime("playwright").chromium;
}

type ProofPage = {
  setViewportSize: (size: { width: number; height: number }) => Promise<void>;
  goto: (url: string, options: { waitUntil: "domcontentloaded" }) => Promise<unknown>;
  waitForFunction: (fn: () => boolean, options: { timeout: number }) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  locator: (selector: string) => { screenshot: (options: { path: string }) => Promise<void> };
};

async function main() {
  const roomId = arg("--room");
  const versionId = arg("--version");
  const baseUrl = process.env.VIBODE_THUMBNAIL_BASE_URL || "http://localhost:3000";
  const chromium = loadChromium();
  mkdirSync(OUT_DIR, { recursive: true });
  const wallStarted = performance.now();
  const mintedResponse = await fetch(`${baseUrl}/api/internal/vibode-thumbnail-render/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, versionId }),
  });
  const minted = await mintedResponse.json() as {
    ok?: boolean;
    code?: string;
    message?: string;
    accessToken?: string;
    frame?: { width: number; height: number };
    objectCount?: number;
  };
  if (!mintedResponse.ok || !minted.ok || !minted.accessToken || !minted.frame) {
    throw new Error(minted.code || minted.message || `Mint failed (${mintedResponse.status}).`);
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  await page.setViewportSize({
    width: minted.frame.width,
    height: minted.frame.height,
  });
  const navigationStarted = performance.now();
  await page.goto(
    `${baseUrl}/internal/vibode-thumbnail-render?access=${encodeURIComponent(minted.accessToken)}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(() => {
    const state = (window as unknown as { __VIBODE_THUMBNAIL_RENDER__?: { status?: string } })
      .__VIBODE_THUMBNAIL_RENDER__;
    return state?.status === "ready" || state?.status === "error";
  }, { timeout: 120_000 });
  const ready = await page.evaluate(() => {
    return (window as unknown as { __VIBODE_THUMBNAIL_RENDER__?: ReadyState })
      .__VIBODE_THUMBNAIL_RENDER__ ?? null;
  });
  if (!ready || ready.status !== "ready") {
    await browser.close();
    throw new Error(`${ready?.error?.code || "render_page_error"}: ${ready?.error?.message || "Render did not become ready."}`);
  }
  const pngPath = join(OUT_DIR, "frame.png");
  const webpPath = join(OUT_DIR, "thumb.webp");
  await page.locator("[data-vibode-thumbnail-frame]").screenshot({ path: pngPath });
  await sharp(pngPath)
    .resize(640, 480, { fit: "cover", position: "centre" })
    .webp({ quality: 80 })
    .toFile(webpPath);
  await browser.close();
  const webpBytes = statSync(webpPath).size;
  const report = {
    roomId,
    versionId,
    objectCount: ready.objectCount ?? minted.objectCount,
    frame: minted.frame,
    wallMs: Math.round(performance.now() - wallStarted),
    navigationMs: Math.round(performance.now() - navigationStarted),
    timing: ready.timing ?? null,
    pngPath,
    webpPath,
    webpBytes,
  };
  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Thumbnail proof failed.";
  process.stderr.write(`${message}\n`);
  if (message.includes("Cannot find module")) {
    process.stderr.write(
      "Playwright is not installed in the UI app. Use /tmp/vibode-thumb-2b-runtime or set VIBODE_THUMBNAIL_PLAYWRIGHT_ROOT.\n",
    );
  }
  process.exit(1);
});
