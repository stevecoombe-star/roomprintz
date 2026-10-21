import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  prepareAuthorizedRemoveCleanupInput,
  type RemoveCleanupExportDeps,
} from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

import { enqueuePreparedCleanupJob } from "./enqueue";
import type { CleanupControl } from "./runtime";
import { cleanupPublicBody, cleanupPublicStatus, cleanupJobStatusView } from "./status";

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CleanupHttpDeps = Readonly<{
  getAdmin: () => Promise<{ id: string } | null>;
  prepareDeps: RemoveCleanupExportDeps;
  control: CleanupControl;
  currentGenerationId?: (roomId: string, userId: string) => Promise<string | null>;
}>;

export async function handleRemoveCleanupEnqueue(request: Request, deps: CleanupHttpDeps): Promise<Response> {
  const prepared = await prepareAuthorizedRemoveCleanupInput(request, deps.prepareDeps);
  if (!prepared.ok) return json({ error: prepared.reason }, prepared.status);
  const queued = await enqueuePreparedCleanupJob(deps.control, prepared.snapshot, {
    userId: prepared.snapshot.userId,
    roomUserId: prepared.snapshot.userId,
    currentGenerationId: prepared.snapshot.generationId,
  });
  if (!queued.ok) return json(cleanupPublicBody(queued.code), cleanupPublicStatus(queued.code));
  const current = await currentGeneration(deps, queued.job.roomId, queued.job.userId);
  return json({
    created: queued.created,
    job: cleanupJobStatusView(queued.job, current),
  }, 200);
}

export async function handleRemoveCleanupRoomStatus(request: Request, deps: CleanupHttpDeps): Promise<Response> {
  const admin = await deps.getAdmin();
  if (!admin) return json({ error: "Not found." }, 404);
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  if (!JOB_ID.test(roomId)) return json({ error: "Not found." }, 404);
  const job = await deps.control.readRoom(admin.id, roomId);
  if (!job) return json({ job: null }, 200);
  const current = await currentGeneration(deps, roomId, admin.id);
  return json({ job: cleanupJobStatusView(job, current) }, 200);
}

export async function handleRemoveCleanupJobStatus(
  request: Request,
  deps: CleanupHttpDeps,
  jobId: string,
): Promise<Response> {
  const admin = await deps.getAdmin();
  if (!admin || !JOB_ID.test(jobId)) return json({ error: "Not found." }, 404);
  const job = await deps.control.readJob(admin.id, jobId);
  if (!job) return json({ error: "Not found." }, 404);
  const current = await currentGeneration(deps, job.roomId, admin.id);
  return json({ job: cleanupJobStatusView(job, current) }, 200);
}

export async function handleRemoveCleanupCandidate(
  deps: CleanupHttpDeps,
  jobId: string,
): Promise<Response> {
  const admin = await deps.getAdmin();
  if (!admin || !JOB_ID.test(jobId)) return json({ error: "Not found." }, 404);
  const job = await deps.control.readJob(admin.id, jobId);
  const view = job ? cleanupJobStatusView(job, null) : null;
  if (!job || !view?.candidateAvailable || !job.outputPath || !job.outputSha256) {
    return json({ error: "Not found." }, 404);
  }
  const bytes = await deps.control.artifacts.get(job.outputPath);
  if (!bytes || sha256Hex(bytes) !== job.outputSha256) return json({ error: "Not found." }, 404);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleRemoveCleanupRetry(deps: CleanupHttpDeps, jobId: string): Promise<Response> {
  const admin = await deps.getAdmin();
  if (!admin || !JOB_ID.test(jobId)) return json({ error: "Not found." }, 404);
  const retried = await deps.control.retry(admin.id, jobId);
  if (!retried.ok) return json(cleanupPublicBody(retried.code), cleanupPublicStatus(retried.code));
  const current = await currentGeneration(deps, retried.job.roomId, admin.id);
  return json({
    created: retried.created,
    job: cleanupJobStatusView(retried.job, current),
  }, 200);
}

export async function handleRemoveCleanupDiscard(deps: CleanupHttpDeps, jobId: string): Promise<Response> {
  const admin = await deps.getAdmin();
  if (!admin || !JOB_ID.test(jobId)) return json({ error: "Not found." }, 404);
  const discarded = await deps.control.discard(admin.id, jobId);
  if (!discarded.ok) return json({ error: "Not found." }, 404);
  const current = await currentGeneration(deps, discarded.job.roomId, admin.id);
  return json({ job: cleanupJobStatusView(discarded.job, current) }, 200);
}

async function currentGeneration(deps: CleanupHttpDeps, roomId: string, userId: string): Promise<string | null> {
  if (!deps.currentGenerationId) return null;
  return deps.currentGenerationId(roomId, userId);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
