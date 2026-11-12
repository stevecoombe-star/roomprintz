/**
 * Customer beta generation rules. This module does not call the network
 * or decide that a reservation succeeded. SQL reserve remains the authority.
 */

import {
  defaultFurnitureGeneratorSettings,
  type FurnitureGeneratorSettings,
} from "@/lib/vibode-furniture/generator/settings";

export type CustomerEntitlementState =
  | "ready"
  | "unapproved"
  | "disabled"
  | "exhausted"
  | "generation_off";

export type CustomerEntitlement = Readonly<{
  canGenerate: boolean;
  state: CustomerEntitlementState;
  authorized: number;
  reserved: number;
  consumed: number;
  remaining: number;
  reason: string | null;
}>;

export type CustomerJobSnapshot = Readonly<{
  jobId: string;
  status: string;
  errorClass: string | null;
  progress: number;
}>;

const SUBMISSION_KEY = /^[a-z0-9-]{8,80}$/;

export function isCertifiedBetaFurnitureSettings(settings: FurnitureGeneratorSettings): boolean {
  const certified = defaultFurnitureGeneratorSettings();
  return settings.geometryResolution === "standard"
    && settings.geometryResolution === certified.geometryResolution
    && settings.shouldTexture === true
    && settings.textureModel === "default"
    && settings.textureResolution === "2k"
    && settings.enablePbr === false
    && settings.texturePrompt === ""
    && settings.imageEnhancement === true
    && settings.shouldRemesh === false
    && settings.topology === "triangle"
    && settings.targetPolycount === 30000
    && settings.targetPolycount === certified.targetPolycount;
}

export function customerEntitlement(input: Readonly<{
  approved: boolean;
  enabled: boolean;
  authorized: number;
  reserved: number;
  consumed: number;
  remaining: number;
  generationEnabled: boolean;
  liveEnabled: boolean;
}>): CustomerEntitlement {
  const counts = {
    authorized: input.authorized,
    reserved: input.reserved,
    consumed: input.consumed,
    remaining: input.remaining,
  };
  if (!input.approved) {
    return {
      canGenerate: false,
      state: "unapproved",
      authorized: 0,
      reserved: 0,
      consumed: 0,
      remaining: 0,
      reason: "This account is not approved for AI furniture generation.",
    };
  }
  if (!input.enabled) {
    return {
      canGenerate: false,
      state: "disabled",
      ...counts,
      reason: "AI generation is turned off for this account.",
    };
  }
  if (input.remaining < 1) {
    return {
      canGenerate: false,
      state: "exhausted",
      ...counts,
      reason: "No AI generations remain.",
    };
  }
  if (!input.generationEnabled || !input.liveEnabled) {
    return {
      canGenerate: false,
      state: "generation_off",
      ...counts,
      reason: "AI generation is temporarily unavailable.",
    };
  }
  return { canGenerate: true, state: "ready", ...counts, reason: null };
}

export function allowanceBalanceLine(entitlement: CustomerEntitlement): string | null {
  if (entitlement.state === "unapproved") return null;
  return `AI Generations Remaining: ${entitlement.remaining}`;
}

export function customerJobCopy(job: CustomerJobSnapshot): Readonly<{
  title: string;
  detail: string;
  poll: boolean;
}> {
  if (job.status === "reserved") {
    return {
      title: "Preparing your photo",
      detail: "The photo is stored for this generation. The model has not started yet.",
      poll: true,
    };
  }
  if (job.status === "submitting" || job.status === "ambiguous") {
    return {
      title: "Submitting",
      detail: "Vibode is submitting this generation. This screen does not start another one.",
      poll: true,
    };
  }
  if (job.status === "running") {
    return { title: "Generating", detail: "The model is being generated.", poll: true };
  }
  if (job.status === "ingesting") {
    return {
      title: "Processing the model",
      detail: "The finished model is being prepared for preview.",
      poll: true,
    };
  }
  if (job.status === "ready") {
    return {
      title: "Ready to preview",
      detail: "Preview the private model, set one real measurement, and save it.",
      poll: false,
    };
  }
  if (job.status === "needs_review") {
    return {
      title: "Awaiting operator review",
      detail: "An operator needs to review this generation. It will not start again on its own.",
      poll: false,
    };
  }
  if (job.status === "failed") {
    return { title: "The generation did not finish", detail: failedDetail(job.errorClass), poll: false };
  }
  if (job.status === "expired") {
    return {
      title: "This preview expired",
      detail: "Generate again when you want a new model.",
      poll: false,
    };
  }
  if (job.status === "saved") {
    return {
      title: "Saved to My Furniture",
      detail: "The calibrated model is in your library.",
      poll: false,
    };
  }
  if (job.status === "cancelled" || job.status === "discarded") {
    return {
      title: "This generation stopped",
      detail: "It will not continue on its own.",
      poll: false,
    };
  }
  return {
    title: "Checking this generation",
    detail: "The latest status could not be shown.",
    poll: false,
  };
}

export function nextPollDelayMs(previousMs: number): number {
  if (!Number.isFinite(previousMs) || previousMs < 2_000) return 2_000;
  return Math.min(previousMs * 2, 15_000);
}

export function shouldRefreshAllowance(status: string): boolean {
  return status === "failed" || status === "cancelled" || status === "discarded" || status === "expired";
}

export function claimBetaSubmission(
  state: Readonly<{ busy: boolean; key: string | null }>,
  mint: () => string,
): Readonly<{ busy: true; key: string }> | null {
  if (state.busy) return null;
  const key = state.key ?? mint();
  if (!SUBMISSION_KEY.test(key)) return null;
  return { busy: true, key };
}

export function submissionKeyAfterOutcome(
  key: string,
  outcome: "uncertain" | "started" | "refused",
): string | null {
  if (outcome === "refused") return null;
  return key;
}

export function betaSubmissionKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `beta-${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16)}`;
}

function failedDetail(errorClass: string | null): string {
  if (errorClass === "rate_limited") return "The generator is busy. You can try a new generation later.";
  if (errorClass === "input_storage_failed") return "The photo could not be stored.";
  if (errorClass === "credit_unreported") return "The result needs an operator to confirm it.";
  if (errorClass === "provider_failed" || errorClass === "provider_rejected") {
    return "The model could not be generated.";
  }
  return "Nothing new was started.";
}
