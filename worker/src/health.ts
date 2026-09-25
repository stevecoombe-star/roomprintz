import { createServer, type Server } from "node:http";

export type WorkerHealth = {
  startedAt: string;
  browserLaunchedAt: string | null;
  lastClaimAt: string | null;
  lastCompletedAt: string | null;
  lastCompletedJobId: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  lastFailureJobId: string | null;
  idle: boolean;
  jobsCompleted: number;
  webglRenderer: string | null;
};

export function createHealthState(): WorkerHealth {
  return {
    startedAt: new Date().toISOString(),
    browserLaunchedAt: null,
    lastClaimAt: null,
    lastCompletedAt: null,
    lastCompletedJobId: null,
    lastFailureAt: null,
    lastFailureCode: null,
    lastFailureJobId: null,
    idle: true,
    jobsCompleted: 0,
    webglRenderer: null,
  };
}

export function startHealthServer(port: number, health: WorkerHealth): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url?.split("?")[0] !== "/health") {
      response.writeHead(404);
      response.end();
      return;
    }
    const body = JSON.stringify({
      status: health.browserLaunchedAt ? "ok" : "starting",
      ...health,
    });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}
