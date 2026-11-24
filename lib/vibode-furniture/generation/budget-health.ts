/**
 * Read-only budget health for the admin generation dashboard.
 * Percentages are derived from the stored counters. They do not change
 * admission, ceilings, or allowances.
 */

import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";

import type { BetaTesterRecord, DashboardOverview } from "./admin-dashboard";
import { estimateMeshy71Credits } from "./credits";

const STANDARD_ESTIMATE = estimateMeshy71Credits(defaultFurnitureGeneratorSettings(), "image-to-3d");
if (STANDARD_ESTIMATE == null) {
  throw new Error("The standard generation credit estimate is unavailable.");
}

/** Certified reservation for the default Image-to-3D settings. Not a measured Meshy charge. */
export const STANDARD_GENERATION_CREDIT_ESTIMATE = STANDARD_ESTIMATE;

const WARNING_RATIO = 0.8;

export type UtilizationKind = "unavailable" | "healthy" | "warning" | "exhausted" | "exceeded";

export type Utilization = {
  kind: UtilizationKind;
  label: "No capacity" | "Healthy" | "Warning" | "Exhausted" | "Exceeded";
  used: number;
  limit: number;
  /** Null when the limit is not a positive number. The displayed percent is never capped. */
  percent: number | null;
  /** Visual bar width. This is the only value clamped to 100. */
  barPercent: number;
};

export type AccountHealth = {
  utilization: Utilization;
  statusLabel: "Disabled" | Utilization["label"];
  disabled: boolean;
};

export type GenerationCapacity = {
  creditsPerGeneration: number;
  creditGenerations: number;
  paidAttemptGenerations: number;
  estimatedGenerations: number;
  headline: string;
  consequence: string;
  concurrency: string;
  worker: string;
};

type CapacityInput = Pick<
  DashboardOverview,
  | "creditsConsumed"
  | "creditsReserved"
  | "creditCeiling"
  | "remainingCreditBudget"
  | "paidSubmissionsAuthorized"
  | "paidSubmissionsUsed"
  | "liveEnabled"
  | "generationAdmissionEnabled"
  | "maxConcurrent"
  | "workerConfiguration"
>;

export function utilization(used: number, limit: number): Utilization {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit < 0) {
    return meter("unavailable", "No capacity", 0, 0, null, 0);
  }
  if (limit === 0) {
    return used === 0
      ? meter("unavailable", "No capacity", 0, 0, null, 0)
      : meter("exceeded", "Exceeded", used, 0, null, 100);
  }
  const percent = (used / limit) * 100;
  const barPercent = Math.min(100, Math.max(0, percent));
  if (used < limit * WARNING_RATIO) return meter("healthy", "Healthy", used, limit, percent, barPercent);
  if (used < limit) return meter("warning", "Warning", used, limit, percent, barPercent);
  if (used === limit) return meter("exhausted", "Exhausted", used, limit, percent, 100);
  return meter("exceeded", "Exceeded", used, limit, percent, 100);
}

export function formatUtilizationPercent(percent: number): string {
  const tenths = Math.round(percent * 10) / 10;
  return Number.isInteger(tenths) ? `${tenths.toFixed(0)}%` : `${tenths.toFixed(1)}%`;
}

export function creditUtilization(overview: Pick<DashboardOverview, "creditsConsumed" | "creditsReserved" | "creditCeiling">): Utilization {
  return utilization(overview.creditsConsumed + overview.creditsReserved, overview.creditCeiling);
}

export function paidSubmissionUtilization(overview: Pick<DashboardOverview, "paidSubmissionsAuthorized" | "paidSubmissionsUsed">): Utilization {
  return utilization(overview.paidSubmissionsUsed, overview.paidSubmissionsAuthorized);
}

export function accountAllowanceHealth(tester: Pick<
  BetaTesterRecord,
  "enabled" | "authorizedGenerations" | "reservedGenerations" | "consumedGenerations"
>): AccountHealth {
  const measured = utilization(
    tester.consumedGenerations + tester.reservedGenerations,
    tester.authorizedGenerations,
  );
  if (!tester.enabled) {
    return { utilization: measured, statusLabel: "Disabled", disabled: true };
  }
  return { utilization: measured, statusLabel: measured.label, disabled: false };
}

export function generationCapacity(overview: CapacityInput): GenerationCapacity {
  const creditsPerGeneration = STANDARD_GENERATION_CREDIT_ESTIMATE;
  const creditGenerations = Math.max(0, Math.floor(overview.remainingCreditBudget / creditsPerGeneration));
  const paidAttemptGenerations = Math.max(0, overview.paidSubmissionsAuthorized - overview.paidSubmissionsUsed);
  const estimatedGenerations = Math.min(creditGenerations, paidAttemptGenerations);
  const credits = creditUtilization(overview);
  const paid = paidSubmissionUtilization(overview);
  const financial = financialSentence({
    credits,
    paid,
    creditGenerations,
    paidAttemptGenerations,
  });
  const admission = admissionSentence(overview);
  const blocked = !overview.generationAdmissionEnabled || !overview.liveEnabled;
  const headline = blocked && financial.startsWith("Capacity available")
    ? `${admission} Budgets could still allow ${estimatedGenerations} estimated generations.`
    : blocked
      ? `${admission} ${financial}`
      : financial;
  return {
    creditsPerGeneration,
    creditGenerations,
    paidAttemptGenerations,
    estimatedGenerations,
    headline,
    consequence: consequenceSentence(overview, financial),
    concurrency: `Concurrency limit is ${overview.maxConcurrent}. Current occupancy is not reported, so a free budget is not confirmation that a generation can start immediately.`,
    worker: overview.workerConfiguration,
  };
}

function meter(
  kind: UtilizationKind,
  label: Utilization["label"],
  used: number,
  limit: number,
  percent: number | null,
  barPercent: number,
): Utilization {
  return { kind, label, used, limit, percent, barPercent };
}

function financialSentence(input: {
  credits: Utilization;
  paid: Utilization;
  creditGenerations: number;
  paidAttemptGenerations: number;
}): string {
  const { credits, paid, creditGenerations, paidAttemptGenerations } = input;
  if (creditGenerations > 0 && paidAttemptGenerations > 0) {
    if (creditGenerations < paidAttemptGenerations) {
      return "Capacity available. The credit budget is the tighter limit.";
    }
    if (paidAttemptGenerations < creditGenerations) {
      return "Capacity available. Paid attempts are the tighter limit.";
    }
    return "Capacity available.";
  }
  if (credits.kind === "unavailable" && paid.kind === "unavailable") {
    return "No credit ceiling or paid-attempt authorization is set.";
  }
  if (credits.kind === "exceeded" && (paid.kind === "exhausted" || paid.kind === "exceeded")) {
    return "The credit budget is over its ceiling and paid attempts are exhausted.";
  }
  if (paid.kind === "exceeded" && (credits.kind === "exhausted" || credits.kind === "exceeded")) {
    return "Paid attempts are over the authorized limit and the credit budget is exhausted.";
  }
  if (
    (credits.kind === "exhausted" || credits.kind === "exceeded")
    && (paid.kind === "exhausted" || paid.kind === "exceeded")
  ) {
    return "Both budgets exhausted.";
  }
  if (paid.kind === "unavailable") {
    return credits.kind === "exceeded"
      ? "The credit budget is over its ceiling. Paid submissions are not authorized."
      : "Paid submissions are not authorized.";
  }
  if (credits.kind === "unavailable") {
    return paid.kind === "exceeded"
      ? "Paid attempts are over the authorized limit. The credit ceiling is not set."
      : "The credit ceiling is not set.";
  }
  if (credits.kind === "exceeded") return "The credit budget is over its ceiling.";
  if (paid.kind === "exceeded") return "Paid attempts are over the authorized limit.";
  if (paidAttemptGenerations === 0) return "Paid attempts exhausted.";
  return "Credit budget exhausted.";
}

function admissionSentence(overview: Pick<DashboardOverview, "generationAdmissionEnabled" | "liveEnabled">): string {
  if (!overview.generationAdmissionEnabled && !overview.liveEnabled) {
    return "Generation admission disabled. Database admission is off.";
  }
  if (!overview.generationAdmissionEnabled) return "Generation admission disabled.";
  if (!overview.liveEnabled) return "Database admission is off.";
  return "Database admission is on. Generation admission is on.";
}

function consequenceSentence(
  overview: Pick<DashboardOverview, "generationAdmissionEnabled" | "liveEnabled">,
  financial: string,
): string {
  if (!overview.generationAdmissionEnabled) {
    return "New generations cannot be admitted while generation admission is off.";
  }
  if (!overview.liveEnabled) {
    return "New generations cannot be admitted while database admission is off.";
  }
  if (financial.startsWith("Both budgets")) {
    return "New generations cannot be admitted until both the credit budget and paid attempts have room.";
  }
  if (financial.startsWith("Paid attempts exhausted") || financial.startsWith("Paid submissions are not authorized")) {
    return "New generations cannot be admitted until more paid attempts are authorized.";
  }
  if (financial.startsWith("Credit budget exhausted") || financial.startsWith("The credit ceiling is not set")) {
    return "New generations cannot be admitted until credit capacity is available.";
  }
  if (financial.startsWith("The credit budget is over") || financial.startsWith("Paid attempts are over")) {
    return "New generations cannot be admitted until the over-limit budget is corrected.";
  }
  if (financial.startsWith("No credit ceiling")) {
    return "New generations cannot be admitted until a credit ceiling and paid attempts are authorized.";
  }
  return "Budgets can admit another estimated generation. Concurrency occupancy and the worker are not verified from this page.";
}
