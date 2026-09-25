import { chromium, type Browser, type Page } from "playwright";

import type { ClaimedJob } from "./client.js";
import type { WorkerEnv } from "./env.js";
import { THUMBNAIL_FRAME_SELECTOR, type RenderReady, type ThumbnailSession } from "./orchestrate.js";

const LAUNCH_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--disable-dev-shm-usage",
];

export type BrowserPool = Readonly<{
  openSession: (job: ClaimedJob) => Promise<ThumbnailSession>;
  close: () => Promise<void>;
  launched: () => boolean;
}>;

export async function launchBrowserPool(env: WorkerEnv): Promise<BrowserPool> {
  let browser = await launch();
  let jobsOnBrowser = 0;
  return {
    launched: () => browser.isConnected(),
    async close() {
      await browser.close().catch(() => undefined);
    },
    async openSession() {
      if (!browser.isConnected() || jobsOnBrowser >= env.browserRecycleAfterJobs) {
        await browser.close().catch(() => undefined);
        browser = await launch();
        jobsOnBrowser = 0;
      }
      const page = await browser.newPage();
      jobsOnBrowser += 1;
      return sessionFor(page, env);
    },
  };
}

async function launch(): Promise<Browser> {
  return chromium.launch({ headless: true, args: LAUNCH_ARGS });
}

function sessionFor(page: Page, env: WorkerEnv): ThumbnailSession {
  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: env.navigationTimeoutMs });
    },
    async waitForReady() {
      await page.waitForFunction(() => {
        const state = (window as unknown as { __VIBODE_THUMBNAIL_RENDER__?: { status?: string } })
          .__VIBODE_THUMBNAIL_RENDER__;
        return state?.status === "ready" || state?.status === "error";
      }, undefined, { timeout: env.readyTimeoutMs });
      return page.evaluate(() => {
        const state = (window as unknown as {
          __VIBODE_THUMBNAIL_RENDER__?: RenderReady;
        }).__VIBODE_THUMBNAIL_RENDER__;
        const canvas = document.querySelector("[data-vibode-thumbnail-mount] canvas");
        const gl = canvas instanceof HTMLCanvasElement
          ? canvas.getContext("webgl2") ?? canvas.getContext("webgl")
          : null;
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        const webglRenderer = gl && debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : null;
        return { ...state, webglRenderer };
      });
    },
    async captureFrame() {
      const frame = page.locator(THUMBNAIL_FRAME_SELECTOR);
      const box = await frame.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        await page.setViewportSize({
          width: Math.ceil(Math.max(box.width, 640)),
          height: Math.ceil(Math.max(box.height, 480)),
        });
      }
      const png = await frame.screenshot({ timeout: env.screenshotTimeoutMs, type: "png" });
      return png;
    },
    async close() {
      await page.close().catch(() => undefined);
    },
  };
}
