/**
 * Worker provider selection. Fake mode is the default, even when a Meshy
 * key is present. Real mode requires the exact provider name, the generation
 * switch, and a credential. Only this module reads that credential.
 */

import { createMeshyAdapter } from "@/lib/vibode-furniture/generation/meshy-adapter";
import { createMeshyFetchTransport, meshyApiKeyFromEnv } from "@/lib/vibode-furniture/generation/meshy-transport";
import type { MeshyTransport, MeshyTransportResult } from "@/lib/vibode-furniture/generation/meshy-task";
import type { GenerationDownloader } from "@/lib/vibode-furniture/generation/output";
import { MESHY_ASSET_HOST, MESHY_GENERATION_ENABLED_ENV } from "@/lib/vibode-furniture/generation/policy";

const PROVIDER_ENV = "VIBODE_FURNITURE_GENERATION_PROVIDER";

export type FurnitureGenerationProviderMode =
  | { ok: true; mode: "fake" | "meshy" }
  | { ok: false; missing: string };

export type FurnitureGenerationWorkerRuntime = Readonly<{
  mode: "fake" | "meshy";
  submitAllowed: boolean;
  adapter: ReturnType<typeof createMeshyAdapter>;
  download: GenerationDownloader;
}>;

export function resolveFurnitureGenerationProvider(
  env: Readonly<Record<string, string | undefined>>,
): FurnitureGenerationProviderMode {
  const selected = env[PROVIDER_ENV]?.trim() ?? "";
  if (selected === "" || selected === "fake") return { ok: true, mode: "fake" };
  if (selected !== "meshy") return { ok: false, missing: "provider_invalid" };
  if (env[MESHY_GENERATION_ENABLED_ENV] !== "true") return { ok: false, missing: "generation_disabled" };
  if (!meshyApiKeyFromEnv(env)) return { ok: false, missing: "meshy_credential_missing" };
  return { ok: true, mode: "meshy" };
}

export function createFurnitureGenerationWorkerRuntime(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  fetchImpl: typeof fetch;
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
}>): { ok: true; runtime: FurnitureGenerationWorkerRuntime } | { ok: false; missing: string } {
  const provider = resolveFurnitureGenerationProvider(input.env);
  if (!provider.ok) return provider;
  if (provider.mode === "fake") {
    return {
      ok: true,
      runtime: {
        mode: "fake",
        submitAllowed: false,
        adapter: createMeshyAdapter({
          async request(): Promise<MeshyTransportResult> {
            return { kind: "network" };
          },
        }),
        download: async () => ({ kind: "network" }),
      },
    };
  }
  const apiKey = meshyApiKeyFromEnv(input.env);
  if (!apiKey) return { ok: false, missing: "meshy_credential_missing" };
  return {
    ok: true,
    runtime: {
      mode: "meshy",
      submitAllowed: true,
      adapter: createMeshyAdapter(loggingTransport(
        createMeshyFetchTransport({ fetchImpl: input.fetchImpl, apiKey }),
        input.log,
      )),
      download: createBoundedMeshyAssetDownloader(input.fetchImpl),
    },
  };
}

export function createBoundedMeshyAssetDownloader(fetchImpl: typeof fetch): GenerationDownloader {
  return async ({ url, timeoutMs, maxBytes }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { kind: "network" };
    }
    if (!isMeshyAsset(parsed)) return { kind: "network" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        return location ? { kind: "redirect", location } : { kind: "network" };
      }
      if (response.status !== 200) return { kind: "network" };
      const contentLength = contentLengthOf(response.headers.get("content-length"));
      if (contentLength != null && contentLength > maxBytes) return { kind: "too_large" };
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > maxBytes) return { kind: "too_large" };
      return { kind: "ok", status: 200, body, contentLength };
    } catch {
      return controller.signal.aborted ? { kind: "timeout" } : { kind: "network" };
    } finally {
      clearTimeout(timer);
    }
  };
}

function loggingTransport(
  inner: MeshyTransport,
  log: (event: string, fields: Record<string, string | number | boolean | null>) => void,
): MeshyTransport {
  return {
    async request(call) {
      const result = await inner.request(call);
      log("provider_request", {
        method: call.method,
        path: call.path.split("?")[0] ?? call.path,
        outcome: result.kind === "response" ? result.status : result.kind,
      });
      return result;
    },
  };
}

function isMeshyAsset(url: URL): boolean {
  return url.protocol === "https:"
    && url.hostname === MESHY_ASSET_HOST
    && url.username === ""
    && url.password === ""
    && url.port === "";
}

function contentLengthOf(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
