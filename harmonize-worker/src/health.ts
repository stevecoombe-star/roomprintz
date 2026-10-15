import { createServer, type Server } from "node:http";

import type { HarmonizeExecuteResult } from "@/lib/vibode-stage/harmonize-jobs/execute";

import type { HarmonizeWorkerOperations, HarmonizeWorkerRecoveryResult } from "./http-api";

export type HarmonizeWorkerHealthSnapshot = Readonly<{
  status: "ok";
  /** The process is up. This is not permission to spend a provider contact. */
  live: true;
  /** Process readiness. True while the process is serving, including when processing is disabled. */
  ready: true;
  readiness: "process";
  processingEnabled: boolean;
  appProcessingEnabled: boolean | null;
  /** True only when this process and the Next app both have processing enabled. */
  providerSpendAuthorized: boolean;
  idle: boolean;
  provider: "google" | "fake";
  lastGenerationClaimAt: string | null;
  lastGenerationCompletedAt: string | null;
  lastRecoveryAt: string | null;
  lastGenerationFailureCode: string | null;
  lastRecoveryFailureCode: string | null;
  globalProviderContactsToday: number | null;
  globalProviderContactLimit: number | null;
}>;

export function createHarmonizeWorkerHealthState(provider: "google" | "fake"): {
  idle: boolean;
  noteGeneration: (result: HarmonizeExecuteResult) => void;
  noteRecovery: (result: HarmonizeWorkerRecoveryResult) => void;
  noteOperations: (operations: HarmonizeWorkerOperations) => void;
  snapshot: (processingEnabled: boolean) => HarmonizeWorkerHealthSnapshot;
} {
  let idle = true;
  let appProcessingEnabled: boolean | null = null;
  let lastGenerationClaimAt: string | null = null;
  let lastGenerationCompletedAt: string | null = null;
  let lastRecoveryAt: string | null = null;
  let lastGenerationFailureCode: string | null = null;
  let lastRecoveryFailureCode: string | null = null;
  let globalProviderContactsToday: number | null = null;
  let globalProviderContactLimit: number | null = null;
  return {
    get idle() {
      return idle;
    },
    set idle(value: boolean) {
      idle = value;
    },
    noteGeneration(result) {
      if (result.outcome === "idle") return;
      lastGenerationClaimAt = new Date().toISOString();
      if (result.outcome === "succeeded") lastGenerationCompletedAt = lastGenerationClaimAt;
      if (result.outcome === "failed" || result.outcome === "stale") lastGenerationFailureCode = result.code;
    },
    noteRecovery(result) {
      if (result.outcome === "idle") return;
      lastRecoveryAt = new Date().toISOString();
      if (result.outcome === "failed" || result.outcome === "unavailable") lastRecoveryFailureCode = result.code;
    },
    noteOperations(operations) {
      globalProviderContactsToday = operations.globalProviderContactsToday;
      globalProviderContactLimit = operations.globalProviderContactLimit;
      appProcessingEnabled = operations.appProcessingEnabled;
    },
    snapshot(processingEnabled) {
      return {
        status: "ok",
        live: true,
        ready: true,
        readiness: "process",
        processingEnabled,
        appProcessingEnabled,
        providerSpendAuthorized: processingEnabled && appProcessingEnabled === true,
        idle,
        provider,
        lastGenerationClaimAt,
        lastGenerationCompletedAt,
        lastRecoveryAt,
        lastGenerationFailureCode,
        lastRecoveryFailureCode,
        globalProviderContactsToday,
        globalProviderContactLimit,
      };
    },
  };
}

export function startHarmonizeWorkerHealthServer(input: Readonly<{
  port: number;
  host?: string;
  snapshot: () => HarmonizeWorkerHealthSnapshot;
}>): Promise<Readonly<{ port: number; close: () => Promise<void> }>> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method !== "GET" || (path !== "/health" && path !== "/ready")) {
      response.writeHead(404, { "cache-control": "no-store", "content-type": "application/json" });
      response.end(JSON.stringify({ status: "not_found" }));
      return;
    }
    const snapshot = input.snapshot();
    response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json" });
    response.end(JSON.stringify(snapshot));
  });
  return listen(server, input.port, input.host ?? "0.0.0.0");
}

function listen(
  server: Server,
  port: number,
  host: string,
): Promise<Readonly<{ port: number; close: () => Promise<void> }>> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      server.off("error", fail);
      reject(error);
    };
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        port: bound,
        close: () => new Promise((done, rejectClose) => {
          server.close((error) => error ? rejectClose(error) : done());
        }),
      });
    });
  });
}
