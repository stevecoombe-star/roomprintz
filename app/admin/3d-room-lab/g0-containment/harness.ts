import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { G0_SYNTHETIC_ASSET_BASE_DIR, G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";

export type G0LoopbackServerHandle = {
  readonly origin: string;
  readonly close: () => Promise<void>;
};

export async function startG0LoopbackAssetServer(input?: {
  host?: "127.0.0.1";
  port?: 3000;
}): Promise<G0LoopbackServerHandle> {
  const host = input?.host ?? "127.0.0.1";
  const port = input?.port ?? 3000;
  const files = await Promise.all(
    Object.values(G0_SYNTHETIC_ASSETS).map(async (asset) => ({
      key: `/${asset.fileName}`,
      buffer: await readFile(path.join(G0_SYNTHETIC_ASSET_BASE_DIR, asset.fileName)),
    }))
  );
  const byPath = new Map(files.map((item) => [item.key, item.buffer]));

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", `http://${host}:${port}`).pathname;
    const buffer = byPath.get(pathname);
    if (!buffer) {
      res.writeHead(404).end("not-found");
      return;
    }
    res.setHeader("content-type", "image/jpeg");
    res.setHeader("content-length", String(buffer.byteLength));
    res.writeHead(200).end(buffer);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`loopback_port_in_use:${host}:${port}`));
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => resolve());
  });

  return {
    origin: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

export async function withG0RouteEnv<T>(
  env: Partial<Record<string, string>>,
  run: () => Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, oldValue] of previous.entries()) {
      if (typeof oldValue === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  }
}

export function buildLabRequestBody(input: {
  imageUrl: string;
  expectedBasisFingerprint: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}) {
  return {
    imageUrl: input.imageUrl,
    frameSize: { width: 320, height: 240 },
    intrinsicSize: {
      width: input.intrinsicWidth ?? 320,
      height: input.intrinsicHeight ?? 240,
    },
    floorRect: { widthMeters: 4, depthMeters: 4 },
    expectedBasisFingerprint: input.expectedBasisFingerprint,
  };
}
