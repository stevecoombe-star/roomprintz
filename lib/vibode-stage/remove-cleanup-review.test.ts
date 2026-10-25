import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { CleanupStatusView } from "@/lib/vibode-stage/remove-cleanup-jobs/types";
import {
  cleanupReviewSources,
  createCleanupObjectUrlStore,
  isAbortError,
  loadCleanupCandidateBlob,
  pollCleanupJob,
  waitForCleanupPoll,
} from "@/lib/vibode-stage/remove-cleanup-review";

const JOB_A = "08e11e8a-c3b5-4845-80ef-4a0a25b48e97";
const JOB_B = "e8853958-13bd-415e-a4f7-da092c2e3a4c";

function view(jobId: string, status: CleanupStatusView["status"], candidateAvailable = status === "succeeded"): CleanupStatusView {
  return {
    jobId,
    status,
    roomId: "077ef88b-c359-4253-bac3-ffc9efbe3a55",
    generationId: "44b6bbd2-dcf4-4842-a752-efc52202d0eb",
    hiddenCount: 1,
    concepts: ["table"],
    createdAt: "2026-10-21T15:29:05.218Z",
    startedAt: status === "queued" ? null : "2026-10-21T15:30:05.745Z",
    completedAt: status === "succeeded" ? "2026-10-21T15:30:28.738Z" : null,
    errorCategory: null,
    candidateAvailable,
    stale: false,
    outputWidth: candidateAvailable ? 2528 : null,
    outputHeight: candidateAvailable ? 1696 : null,
    stageRegistration: "not-assessed",
    historyAssetId: null,
    accepted: false,
  };
}

test("a queued job can become succeeded without a second status request in flight", async () => {
  const published: CleanupStatusView["status"][] = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let releaseFirst: (job: CleanupStatusView) => void = () => {};
  const first = new Promise<CleanupStatusView>((resolve) => {
    releaseFirst = resolve;
  });
  const done = pollCleanupJob({
    jobId: JOB_A,
    signal: new AbortController().signal,
    intervalMs: 2000,
    load: async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (calls === 1) return await first;
        return view(JOB_A, "succeeded");
      } finally {
        inFlight -= 1;
      }
    },
    publish: (job) => published.push(job.status),
    wait: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(maxInFlight, 1);
  releaseFirst(view(JOB_A, "running"));
  assert.equal(await done, "terminal");
  assert.deepEqual(published, ["running", "succeeded"]);
  assert.equal(calls, 2);
  assert.equal(maxInFlight, 1);
});

test("aborting status polling does not cancel candidate loading", async () => {
  const pollController = new AbortController();
  const candidateController = new AbortController();
  let releaseStatus: (job: CleanupStatusView) => void = () => {};
  const status = new Promise<CleanupStatusView>((resolve) => {
    releaseStatus = resolve;
  });
  const poll = pollCleanupJob({
    jobId: JOB_A,
    signal: pollController.signal,
    intervalMs: 2000,
    load: async (_jobId, signal) => {
      signal.addEventListener("abort", () => undefined);
      return status;
    },
    publish: () => {},
    wait: async () => {},
  });
  const created: string[] = [];
  const candidate = loadCleanupCandidateBlob({
    jobId: JOB_A,
    signal: candidateController.signal,
    fetchCandidate: async () => new Blob(["jpeg"]),
    createObjectUrl: () => {
      const url = `blob:candidate-${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: () => {},
  });
  pollController.abort();
  releaseStatus(view(JOB_A, "succeeded"));
  assert.equal(await poll, "cancelled");
  assert.deepEqual(await candidate, { ok: true, url: "blob:candidate-1" });
  assert.equal(candidateController.signal.aborted, false);
  assert.equal(isAbortError(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })), true);
});

test("expected cancellation does not create a candidate url or reject", async () => {
  const controller = new AbortController();
  let created = 0;
  const result = await loadCleanupCandidateBlob({
    jobId: JOB_A,
    signal: controller.signal,
    fetchCandidate: async (_jobId, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      });
      controller.abort();
    }),
    createObjectUrl: () => {
      created += 1;
      return "blob:unused";
    },
    revokeObjectUrl: () => {},
  });
  assert.deepEqual(result, { ok: false, cancelled: true });
  assert.equal(created, 0);
});

test("aborting a poll while it waits resolves as cancellation", async () => {
  const controller = new AbortController();
  const result = pollCleanupJob({
    jobId: JOB_A,
    signal: controller.signal,
    intervalMs: 1000,
    load: async () => view(JOB_A, "queued"),
    publish: () => {},
    wait: async (_ms, signal) => {
      controller.abort();
      await waitForCleanupPoll(1000, signal);
    },
  });
  assert.equal(await result, "cancelled");
});

test("a candidate url created after cancellation is revoked", async () => {
  const controller = new AbortController();
  const revoked: string[] = [];
  const result = await loadCleanupCandidateBlob({
    jobId: JOB_A,
    signal: controller.signal,
    fetchCandidate: async () => new Blob(["jpeg"]),
    createObjectUrl: () => {
      controller.abort();
      return "blob:late";
    },
    revokeObjectUrl: (url) => revoked.push(url),
  });
  assert.deepEqual(result, { ok: false, cancelled: true });
  assert.deepEqual(revoked, ["blob:late"]);
});

test("a failed candidate read is a quiet result and a later reopen can load it", async () => {
  const reads: string[] = [];
  const failed = await loadCleanupCandidateBlob({
    jobId: JOB_A,
    signal: new AbortController().signal,
    fetchCandidate: async () => null,
    createObjectUrl: () => "blob:unused",
    revokeObjectUrl: () => {},
  });
  assert.deepEqual(failed, { ok: false, cancelled: false });
  const thrown = await loadCleanupCandidateBlob({
    jobId: JOB_A,
    signal: new AbortController().signal,
    fetchCandidate: async () => {
      throw new Error("network");
    },
    createObjectUrl: () => "blob:unused",
    revokeObjectUrl: () => {},
  });
  assert.deepEqual(thrown, { ok: false, cancelled: false });
  const reopened = await loadCleanupCandidateBlob({
    jobId: JOB_A,
    signal: new AbortController().signal,
    fetchCandidate: async (jobId) => {
      reads.push(jobId);
      return new Blob(["jpeg"]);
    },
    createObjectUrl: () => "blob:reopened",
    revokeObjectUrl: () => {},
  });
  assert.deepEqual(reopened, { ok: true, url: "blob:reopened" });
  assert.deepEqual(reads, [JOB_A]);
});

test("replacing the reviewed job revokes the previous blob url", () => {
  const revoked: string[] = [];
  const store = createCleanupObjectUrlStore((url) => revoked.push(url));
  store.replace("blob:job-a");
  store.release();
  assert.equal(store.current(), null);
  store.replace("blob:job-b");
  assert.equal(store.current(), "blob:job-b");
  store.release();
  assert.deepEqual(revoked, ["blob:job-a", "blob:job-b"]);
  assert.equal(store.current(), null);
});

test("a stale status response for another job is not published", async () => {
  const published: string[] = [];
  let calls = 0;
  const result = await pollCleanupJob({
    jobId: JOB_A,
    signal: new AbortController().signal,
    intervalMs: 1,
    load: async () => {
      calls += 1;
      return calls === 1 ? view(JOB_B, "succeeded") : view(JOB_A, "succeeded");
    },
    publish: (job) => published.push(job.jobId),
    wait: async () => {},
  });
  assert.equal(result, "terminal");
  assert.deepEqual(published, [JOB_A]);
});

test("review modes select the original, candidate, or both", () => {
  assert.deepEqual(cleanupReviewSources("original"), ["original"]);
  assert.deepEqual(cleanupReviewSources("candidate"), ["candidate"]);
  assert.deepEqual(cleanupReviewSources("compare"), ["original", "candidate"]);
  const component = readFileSync(new URL("../../components/stage/RemoveCleanupGeneration.tsx", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../../components/stage/RemoveCleanupReviewViewer.tsx", import.meta.url), "utf8");
  assert.match(component, /pollCleanupJob/);
  assert.match(component, /loadCleanupCandidateBlob/);
  assert.match(component, /removeAlignmentArtifactPath\(job\.roomId, "original", job\.generationId\)/);
  assert.match(component, /\/candidate/);
  assert.match(component, /setViewerOpen\(false\)/);
  assert.match(viewer, /data-remove-cleanup-review="close"/);
  assert.match(viewer, /Original room/);
  assert.match(viewer, /Clean Up candidate/);
  assert.doesNotMatch(`${component}\n${viewer}`, /publishHarmonize|vibode_generation_runs|room_scale_multiplier|requestRemoveObjects|generativelanguage/);
});
