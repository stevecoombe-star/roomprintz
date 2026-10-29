import { createServer, type Server } from "node:http";

export type CleanupWorkerHealthSnapshot = Readonly<{
  status: "ok";
  /** The process is up. This is not permission to spend a provider contact. */
  live: true;
  /** Process readiness. True while the process is serving, including when processing is disabled. */
  ready: true;
  readiness: "process";
  processingEnabled: boolean;
  idle: boolean;
  provider: "google" | "fake";
}>;

export function startCleanupWorkerHealthServer(input: Readonly<{
  port: number;
  host?: string;
  snapshot: () => CleanupWorkerHealthSnapshot;
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
