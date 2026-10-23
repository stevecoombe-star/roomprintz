import { NextResponse } from "next/server";

import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { callCompositorAfcSr1Readiness } from "@/lib/callCompositorAfcSr1Readiness";
import { CompositorTransportError } from "@/lib/compositorTransportError";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const PROBE_FLAG = "VIBODE_COMPOSITOR_CONNECTIVITY_PROBE_ENABLED";
const PROBE_TIMEOUT_MS = 5_000;

type ProbeStatus = "authenticated" | "rejected" | "unavailable";

type ProbeDeps = Readonly<{
  getAuthenticatedAdminUser: () => Promise<unknown>;
  callCompositorAfcSr1Readiness: (signal?: AbortSignal) => Promise<unknown>;
}>;

type ReadinessOutcome =
  | { kind: "success" }
  | { kind: "failure"; error: unknown }
  | { kind: "deadline" };

const productionDeps: ProbeDeps = Object.freeze({
  getAuthenticatedAdminUser,
  callCompositorAfcSr1Readiness,
});

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}

function probeResult(httpStatus: number, status: ProbeStatus): NextResponse {
  return NextResponse.json({ status }, { status: httpStatus, headers: noStoreHeaders() });
}

function closed(httpStatus: 403 | 404): NextResponse {
  return new NextResponse(null, { status: httpStatus, headers: noStoreHeaders() });
}

function isConfirmedDownstreamAuthRejection(error: unknown): boolean {
  if (!(error instanceof CompositorTransportError)) return false;
  if (error.seam !== "readiness") return false;
  return (
    (error.classification === "http_401" && error.httpStatus === 401) ||
    (error.classification === "http_403" && error.httpStatus === 403)
  );
}

function readinessWithDeadline(
  call: (signal: AbortSignal) => Promise<unknown>,
): Promise<ReadinessOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ReadinessOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "deadline" });
    }, PROBE_TIMEOUT_MS);
  });
  // Attach both handlers before racing so a late rejection cannot surface
  // after the deadline has already settled the diagnostic.
  const operation = Promise.resolve()
    .then(() => call(controller.signal))
    .then(
      (): ReadinessOutcome => ({ kind: "success" }),
      (error: unknown): ReadinessOutcome => ({ kind: "failure", error }),
    );

  return Promise.race([operation, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Offline test seam. The exported GET handler does not accept this argument
 * and always calls the real admin and readiness helpers.
 */
export async function runCompositorConnectivityProbe(
  deps: ProbeDeps,
): Promise<NextResponse> {
  if (process.env[PROBE_FLAG] !== "1") return closed(404);

  let admin: unknown;
  try {
    admin = await deps.getAuthenticatedAdminUser();
  } catch {
    return probeResult(503, "unavailable");
  }
  if (!admin) return closed(403);

  const outcome = await readinessWithDeadline((signal) =>
    deps.callCompositorAfcSr1Readiness(signal),
  );
  if (outcome.kind === "success") return probeResult(200, "authenticated");
  if (
    outcome.kind === "failure" &&
    isConfirmedDownstreamAuthRejection(outcome.error)
  ) {
    return probeResult(502, "rejected");
  }
  return probeResult(503, "unavailable");
}

export async function GET(_request: Request): Promise<NextResponse> {
  void _request;
  return runCompositorConnectivityProbe(productionDeps);
}
