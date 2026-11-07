/**
 * Optional fetch transport. Callers pass the credential in.
 * App routes do not read MESHY_API_KEY. The worker reads it only after
 * real mode is explicitly selected. A missing key does not invent one.
 */

import { MESHY_API_ORIGIN } from "./policy";
import type { MeshyTransport, MeshyTransportResult } from "./meshy-task";

const HEADER_ALLOWLIST = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];

export function meshyApiKeyFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const key = env.MESHY_API_KEY?.trim() ?? "";
  return key.length > 0 ? key : null;
}

export function createMeshyFetchTransport(input: Readonly<{
  fetchImpl: typeof fetch;
  apiKey: string;
}>): MeshyTransport {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("meshy_transport_unconfigured");
  return {
    async request(call) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), call.timeoutMs);
      try {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${apiKey}`);
        if (call.body) headers.set("Content-Type", "application/json");
        const response = await input.fetchImpl(`${MESHY_API_ORIGIN}/openapi${call.path}`, {
          method: call.method,
          headers,
          body: call.body ? JSON.stringify(call.body) : undefined,
          redirect: "manual",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) return { kind: "network" };
        const text = await response.text();
        let body: unknown = null;
        let unparsed = false;
        if (text.trim()) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            unparsed = true;
          }
        }
        return {
          kind: "response",
          status: response.status,
          headers: allowHeaders(response.headers),
          body,
          unparsed,
        };
      } catch {
        return controller.signal.aborted
          ? { kind: "timeout" }
          : { kind: "network" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function allowHeaders(headers: Headers): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of HEADER_ALLOWLIST) {
    const value = headers.get(name);
    if (value) picked[name] = value.slice(0, 80);
  }
  return picked;
}

export function transportNeverIncludesKey(result: MeshyTransportResult, apiKey: string): boolean {
  return !JSON.stringify(result).includes(apiKey);
}
