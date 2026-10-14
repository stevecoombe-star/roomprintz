export type HarmonizeWorkerClaim = Readonly<{
  jobId: string;
  roomId: string;
  claimNonce: string;
  prompt: string;
  promptSha256: string;
  compositeSha256: string;
  compositeWidth: number;
  compositeHeight: number;
  requestedModelId: string;
}>;

export type HarmonizeWorkerCompletion = Readonly<{
  output: Uint8Array;
  returnedModelId: string | null;
  providerStatus: string | null;
  providerHttpStatus: number | null;
  latencyMs: number;
}>;

export type HarmonizeWorkerFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  providerStatus?: string | null;
  providerHttpStatus?: number | null;
  latencyMs?: number | null;
}>;

export type HarmonizeHistoryWorkerView = Readonly<{
  outcome: "published" | "already_published" | "pending" | "terminal" | "ignored" | "skipped";
  code: string | null;
}>;

export type HarmonizeWorkerApi = Readonly<{
  claim: () => Promise<HarmonizeWorkerClaim | null>;
  composite: (claim: HarmonizeWorkerClaim) => Promise<Uint8Array>;
  contact: (claim: HarmonizeWorkerClaim) => Promise<
    | Readonly<{ ok: true; attemptId: string }>
    | Readonly<{ ok: false; code: string }>
  >;
  heartbeat: (claim: HarmonizeWorkerClaim) => Promise<boolean>;
  complete: (claim: HarmonizeWorkerClaim, completion: HarmonizeWorkerCompletion) => Promise<
    | Readonly<{ ok: true; code: string; history?: HarmonizeHistoryWorkerView }>
    | Readonly<{ ok: false; code: string }>
  >;
  fail: (claim: HarmonizeWorkerClaim, failure: HarmonizeWorkerFailure) => Promise<
    | Readonly<{ ok: true; code: string }>
    | Readonly<{ ok: false; code: string }>
  >;
}>;
