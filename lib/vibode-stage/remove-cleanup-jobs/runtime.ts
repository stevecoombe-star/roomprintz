import type { CleanupArtifactStore } from "./artifacts";
import {
  claimNextCleanupJob,
  completeCleanupJob,
  createCleanupJobDatabase,
  discardCleanupJob,
  enqueueCleanupJob,
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
} from "./types";

export type CleanupControl = {
  now(): number;
  artifacts: CleanupArtifactStore;
  enqueue(insert: CleanupJobInsert): Promise<CleanupEnqueueResult>;
  readJob(userId: string, jobId: string): Promise<CleanupJobRow | null>;
  readRoom(userId: string, roomId: string): Promise<CleanupJobRow | null>;
  discard(userId: string, jobId: string): Promise<CleanupDiscardResult>;
  claim(jobId?: string | null): Promise<CleanupClaim | null>;
  heartbeat(jobId: string, claimNonce: string): Promise<boolean>;
  contact(jobId: string, claimNonce: string): Promise<CleanupContactResult>;
  fail(jobId: string, claimNonce: string, failure: CleanupFailInput): Promise<CleanupFailResult>;
  complete(jobId: string, claimNonce: string, output: CleanupCompleteInput): Promise<CleanupCompleteResult>;
  settle(jobId: string, output: CleanupCompleteInput): Promise<CleanupCompleteResult>;
  recoverable(): Promise<CleanupJobRow[]>;
};

export function createMemoryCleanupControl(input: Readonly<{
  artifacts: CleanupArtifactStore;
  now?: () => number;
  database?: CleanupJobDatabase;
}>): CleanupControl & { database: CleanupJobDatabase } {
  const database = input.database ?? createCleanupJobDatabase();
  const now = input.now ?? (() => Date.now());
  return {
    database,
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
  };
}
