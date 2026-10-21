import {
  acceptCleanupHistory,
  createCleanupHistoryLedger,
  type CleanupHistoryAcceptResult,
  type CleanupHistoryLedger,
} from "@/lib/vibode-stage/remove-cleanup-history";

import type { CleanupArtifactStore } from "./artifacts";
import {
  claimNextCleanupJob,
  completeCleanupJob,
  createCleanupJobDatabase,
  discardCleanupJob,
  enqueueCleanupJob,
  retryCleanupJob,
  failCleanupJob,
  heartbeatCleanupJob,
  markCleanupProviderContact,
  readCleanupJob,
  readLatestCleanupJobForRoom,
  recoverableCleanupJobs,
  settleCleanupCandidate,
} from "./engine";
import type {
  CleanupClaim,
  CleanupCompleteInput,
  CleanupCompleteResult,
  CleanupContactResult,
  CleanupDiscardResult,
  CleanupEnqueueResult,
  CleanupFailInput,
  CleanupFailResult,
  CleanupJobDatabase,
  CleanupJobInsert,
  CleanupJobRow,
  CleanupRetryResult,
} from "./types";

export type CleanupControl = {
  now(): number;
  artifacts: CleanupArtifactStore;
  enqueue(insert: CleanupJobInsert): Promise<CleanupEnqueueResult>;
  readJob(userId: string, jobId: string): Promise<CleanupJobRow | null>;
  readRoom(userId: string, roomId: string): Promise<CleanupJobRow | null>;
  discard(userId: string, jobId: string): Promise<CleanupDiscardResult>;
  retry(userId: string, jobId: string): Promise<CleanupRetryResult>;
  claim(jobId?: string | null): Promise<CleanupClaim | null>;
  heartbeat(jobId: string, claimNonce: string): Promise<boolean>;
  contact(jobId: string, claimNonce: string): Promise<CleanupContactResult>;
  fail(jobId: string, claimNonce: string, failure: CleanupFailInput): Promise<CleanupFailResult>;
  complete(jobId: string, claimNonce: string, output: CleanupCompleteInput): Promise<CleanupCompleteResult>;
  settle(jobId: string, output: CleanupCompleteInput): Promise<CleanupCompleteResult>;
  recoverable(): Promise<CleanupJobRow[]>;
  accept(userId: string, jobId: string): Promise<CleanupHistoryAcceptResult>;
};

export function createMemoryCleanupControl(input: Readonly<{
  artifacts: CleanupArtifactStore;
  now?: () => number;
  database?: CleanupJobDatabase;
  ledger?: CleanupHistoryLedger;
  decode?: (bytes: Uint8Array) => Promise<Readonly<{ width: number; height: number; orientation: number }> | null>;
}>): CleanupControl & { database: CleanupJobDatabase; ledger: CleanupHistoryLedger } {
  const database = input.database ?? createCleanupJobDatabase();
  const ledger = input.ledger ?? createCleanupHistoryLedger();
  const now = input.now ?? (() => Date.now());
  const decode = input.decode ?? (async () => null);
  return {
    database,
    ledger,
    artifacts: input.artifacts,
    now,
    async enqueue(insert) {
      return enqueueCleanupJob(database, insert, now());
    },
    async readJob(userId, jobId) {
      return readCleanupJob(database, userId, jobId);
    },
    async readRoom(userId, roomId) {
      return readLatestCleanupJobForRoom(database, userId, roomId);
    },
    async discard(userId, jobId) {
      return discardCleanupJob(database, userId, jobId, now());
    },
    async retry(userId, jobId) {
      return retryCleanupJob(database, userId, jobId, now());
    },
    async claim(jobId = null) {
      return claimNextCleanupJob(database, now(), jobId);
    },
    async heartbeat(jobId, claimNonce) {
      return heartbeatCleanupJob(database, { jobId, claimNonce, nowMs: now() });
    },
    async contact(jobId, claimNonce) {
      return markCleanupProviderContact(database, { jobId, claimNonce, nowMs: now() });
    },
    async fail(jobId, claimNonce, failure) {
      return failCleanupJob(database, { jobId, claimNonce, nowMs: now(), ...failure });
    },
    async complete(jobId, claimNonce, output) {
      return completeCleanupJob(database, { jobId, claimNonce, nowMs: now(), ...output });
    },
    async settle(jobId, output) {
      return settleCleanupCandidate(database, { jobId, nowMs: now(), ...output });
    },
    async recoverable() {
      return recoverableCleanupJobs(database);
    },
    async accept(userId, jobId) {
      const job = readCleanupJob(database, userId, jobId);
      const bytes = job?.outputPath ? (await input.artifacts.get(job.outputPath)) ?? null : null;
      return acceptCleanupHistory({ job, bytes, nowMs: now(), ledger, decode });
    },
  };
}
