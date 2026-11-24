/**
 * Static render of the read-only furniture generation dashboard.
 * Empty and populated states use fixture records, not Production data.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { FURNITURE_GENERATION_WORKER_STATUS } from "@/lib/vibode-furniture/generation/admin-dashboard";
import type {
  DashboardOverview,
  JobDetailRecord,
  TesterJobPage,
  TesterPage,
} from "@/lib/vibode-furniture/generation/admin-dashboard";

import {
  FurnitureGenerationDashboardView,
  type FurnitureGenerationDashboardViewProps,
} from "./FurnitureGenerationDashboardView";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

test("empty, error, and populated dashboard states stay read-only", () => {
  const empty = render(view({
    phase: "ready",
    overview: overview(),
    testers: { total: 0, limit: 25, offset: 0, testers: [] },
  }));
  assert.match(empty, /AI Furniture Generation/);
  assert.match(empty, /Beta Access &amp; Usage Management/);
  assert.match(empty, /No approved beta accounts\./);
  assert.match(empty, /No historical jobs without a tester allowance\./);
  assert.match(empty, new RegExp(escapeRegExp(FURNITURE_GENERATION_WORKER_STATUS)));
  assert.match(empty, /Database live_enabled/);
  assert.match(empty, /Save beta budget/);
  assert.match(empty, /Consumed credits stay at/);
  assert.match(empty, /Estimated additional generations/);
  assert.match(empty, /Meshy API key monthly limit/);
  assert.match(empty, /No budget adjustments have been recorded/);
  assert.match(empty, /1000000000/);
  assert.match(empty, /Generation environment admission/);
  assert.match(empty, /Off/);
  assert.doesNotMatch(empty, /method="post"|Enable generation|Grant allowance|Increase spending|Paid retry/i);

  const loading = render(view({ phase: "loading" }));
  assert.match(loading, /Loading AI furniture generation status/);
  assert.doesNotMatch(loading, /Consumed generations/);

  const error = render(view({
    phase: "error",
    message: "The furniture generation dashboard could not be loaded.",
  }));
  assert.match(error, /could not be loaded/);
  assert.doesNotMatch(error, /Meshy credits consumed/);

  const populated = render(view({
    phase: "ready",
    overview: overview({
      approvedAccounts: 2,
      enabledAccounts: 1,
      authorizedGenerations: 15,
      reservedGenerations: 1,
      consumedGenerations: 6,
      remainingGenerations: 8,
      paidSubmissionsAuthorized: 1,
      paidSubmissionsUsed: 1,
      confirmedProviderTasks: 4,
      usableCandidates: 0,
      permanentlySavedModels: 1,
      providerFailures: 1,
      creditsReserved: 30,
      creditsConsumed: 20,
      remainingCreditBudget: -10,
      unresolvedProviderCreditExposure: 30,
      historicalJobsWithoutAllowance: 1,
      historicalJobs: [{
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
        userId: USER_C,
        createdAt: "2026-11-04T00:00:00.000Z",
        status: "failed",
        operation: "image-to-3d",
        aiModel: "meshy-7.1",
        imageSlots: ["front"],
        allowanceState: null,
        reservedCredits: 30,
        consumedCredits: 20,
        quotaState: "reconciled",
        errorClass: "provider_failed",
        providerStatus: "FAILED",
        providerTaskConfirmed: true,
        providerCreditReview: "reported",
        savedAssetStatus: "not_saved",
        unresolved: false,
        profile: profile(),
      }],
    }),
    testers: testers(),
    jobs,
    jobsPhase: "ready",
    detail,
    detailPhase: "ready",
  }));
  assert.match(populated, /Consumed generations<\/h3><p[^>]*>6<\/p>/);
  assert.match(populated, /Meshy credits consumed<\/h3><p[^>]*>20<\/p>/);
  assert.match(populated, /Unresolved provider-credit exposure<\/h3><p[^>]*>30<\/p>/);
  assert.match(populated, /ada@example.com/);
  assert.match(populated, /Individual Beta/);
  assert.match(populated, /Enabled/);
  assert.match(populated, /partner@example.com/);
  assert.match(populated, /Furniture Partner/);
  assert.match(populated, /Disabled/);
  assert.match(populated, /No tester allowance/);
  assert.match(populated, /Unresolved/);
  assert.match(populated, /operator_recovery/);
  assert.match(populated, /submission_budget_exhausted/);
  assert.match(populated, /submission_committed/);
  assert.match(populated, /Showing 1–2 of 5/);
  assert.match(populated, /Approve account/);
  assert.match(populated, /Exact email/);
  assert.match(populated, /Initial generation allowance/);
  assert.match(populated, /I confirm this tester change/);
  assert.match(populated, /Save tester changes/);
  assert.match(populated, /Manage/);
  assert.match(populated, /Allow new generations/);
  assert.match(populated, /Approving an account does not change the global credit ceiling/);
  assert.equal(populated.includes(USER_C), true);
  assert.doesNotMatch(populated, /legacy@example.com|candidate\.glb|users\/hidden|MESHY_API_KEY|method="post"/);
});

test("a removed account shows retained audit events without a tester allowance", () => {
  const html = render(view({
    phase: "ready",
    overview: overview(),
    testers: { total: 0, limit: 25, offset: 0, testers: [] },
    jobs: {
      userId: "44444444-4444-4444-8444-444444444444",
      email: null,
      approved: false,
      total: 0,
      limit: 20,
      offset: 0,
      jobs: [],
      allowanceEvents: [{
        eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
        action: "grant",
        reason: "Initial beta allowance",
        actorKind: "administrator",
        actorUserId: null,
        deltaAuthorized: 1,
        deltaReserved: 0,
        deltaConsumed: 0,
        jobId: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        classificationBefore: "individual_beta",
        classificationAfter: "furniture_partner",
        enabledBefore: true,
        enabledAfter: false,
      }],
      resubmitEvents: [],
      creditResolutions: [],
    },
    jobsPhase: "ready",
    budgetEvents: [{
      eventId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      actorUserId: "55555555-5555-4555-8555-555555555555",
      reason: "Owner approved the operating budget",
      liveEnabledBefore: false,
      liveEnabledAfter: false,
      creditCeilingBefore: 60,
      creditCeilingAfter: 300,
      paidSubmissionsAuthorizedBefore: 2,
      paidSubmissionsAuthorizedAfter: 10,
      creditsConsumed: 60,
      creditsReserved: 0,
      paidSubmissionsUsed: 2,
      createdAt: "2026-11-14T20:00:00.000Z",
    }],
  }));
  assert.match(html, /Owner approved the operating budget/);
  assert.match(html, /Ceiling 60 to 300/);
  assert.match(html, /No beta allowance on this account/);
  assert.match(html, /No generation jobs for this account/);
  assert.match(html, /Initial beta allowance/);
  assert.match(html, /Classification Individual Beta to Furniture Partner/);
  assert.match(html, /Access enabled to disabled/);
});

test("capacity health shows the blocking limit and refreshes from the saved budget", () => {
  const blocked = render(view({
    phase: "ready",
    overview: overview({
      liveEnabled: true,
      generationAdmissionEnabled: true,
      creditCeiling: 500,
      creditsConsumed: 100,
      creditsReserved: 30,
      remainingCreditBudget: 370,
      paidSubmissionsAuthorized: 20,
      paidSubmissionsUsed: 20,
    }),
    testers: testers(),
  }));
  assert.match(blocked, /Generation capacity/);
  assert.match(blocked, /Paid attempts exhausted/);
  assert.match(blocked, /New generations cannot be admitted until more paid attempts are authorized/);
  assert.match(blocked, /130 \/ 500 — 26% — Healthy/);
  assert.match(blocked, /20 \/ 20 — 100% — Exhausted/);
  assert.match(blocked, /0 estimated — 100% — Exhausted/);
  assert.match(blocked, /Current occupancy is not reported/);
  assert.match(blocked, /Worker configuration: Not verified from this application/);
  assert.match(blocked, /https:\/\/www\.meshy\.ai\/developers/);
  assert.match(blocked, /Meshy API key limits are managed separately/);
  assert.doesNotMatch(blocked, /fully operational|Railway worker is operational/i);
  const ada = blocked.slice(blocked.indexOf("ada@example.com"), blocked.indexOf("partner@example.com"));
  const partner = blocked.slice(blocked.indexOf("partner@example.com"), blocked.indexOf("Jobs without a tester allowance"));
  assert.match(ada, /Individual Beta/);
  assert.match(ada, /3 \/ 5 — 60% — Healthy/);
  assert.match(partner, /Furniture Partner/);
  assert.match(partner, /4 \/ 10 — 40% — Disabled/);
  assert.doesNotMatch(partner, /Healthy|Exhausted/);

  const refreshed = render(view({
    phase: "ready",
    overview: overview({
      liveEnabled: true,
      generationAdmissionEnabled: true,
      creditCeiling: 500,
      creditsConsumed: 100,
      creditsReserved: 30,
      remainingCreditBudget: 370,
      paidSubmissionsAuthorized: 40,
      paidSubmissionsUsed: 20,
    }),
    testers: {
      total: 1,
      limit: 25,
      offset: 0,
      testers: [{
        userId: USER_A,
        email: "ada@example.com",
        classification: "individual_beta",
        enabled: true,
        authorizedGenerations: 5,
        reservedGenerations: 0,
        consumedGenerations: 5,
        remainingGenerations: 0,
        updatedAt: "2026-11-05T00:00:00.000Z",
      }],
    },
  }));
  assert.match(refreshed, /Capacity available/);
  assert.match(refreshed, /20 \/ 40 — 50% — Healthy/);
  assert.match(refreshed, /12 estimated/);
  assert.match(refreshed, /5 \/ 5 — 100% — Exhausted/);
  assert.match(refreshed, /Save beta budget/);
  assert.match(refreshed, /Save tester changes/);
});

function render(props: FurnitureGenerationDashboardViewProps): string {
  return renderToStaticMarkup(createElement(FurnitureGenerationDashboardView, props));
}

function view(overrides: Partial<FurnitureGenerationDashboardViewProps>): FurnitureGenerationDashboardViewProps {
  return {
    phase: "ready",
    message: null,
    notice: null,
    overview: null,
    testers: null,
    testerQuery: "",
    jobs: null,
    jobsPhase: "idle",
    jobsMessage: null,
    detail: null,
    detailPhase: "idle",
    detailMessage: null,
    ...overrides,
  };
}

function overview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    approvedAccounts: 0,
    enabledAccounts: 0,
    authorizedGenerations: 0,
    reservedGenerations: 0,
    consumedGenerations: 0,
    remainingGenerations: 0,
    paidSubmissionsAuthorized: 0,
    paidSubmissionsUsed: 0,
    confirmedProviderTasks: 0,
    usableCandidates: 0,
    permanentlySavedModels: 0,
    providerFailures: 0,
    creditsReserved: 0,
    creditsConsumed: 0,
    creditCeiling: 40,
    remainingCreditBudget: 40,
    unresolvedProviderCreditExposure: 0,
    liveEnabled: false,
    maxConcurrent: 1,
    deletedAccountAuditEvents: 0,
    deletedAccountAudits: [],
    historicalJobsWithoutAllowance: 0,
    historicalJobs: [],
    generationAdmissionEnabled: false,
    workerConfiguration: FURNITURE_GENERATION_WORKER_STATUS,
    ...overrides,
  };
}

function testers(): TesterPage {
  return {
    total: 2,
    limit: 25,
    offset: 0,
    testers: [
      {
        userId: USER_A,
        email: "ada@example.com",
        classification: "individual_beta",
        enabled: true,
        authorizedGenerations: 5,
        reservedGenerations: 1,
        consumedGenerations: 2,
        remainingGenerations: 2,
        updatedAt: "2026-11-05T00:00:00.000Z",
      },
      {
        userId: USER_B,
        email: "partner@example.com",
        classification: "furniture_partner",
        enabled: false,
        authorizedGenerations: 10,
        reservedGenerations: 0,
        consumedGenerations: 4,
        remainingGenerations: 6,
        updatedAt: "2026-11-03T00:00:00.000Z",
      },
    ],
  };
}

const jobs: TesterJobPage = {
  userId: USER_A,
  email: "ada@example.com",
  approved: true,
  total: 5,
  limit: 2,
  offset: 0,
  jobs: [jobRecord(JOB, true), jobRecord("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", false)],
  allowanceEvents: [],
  resubmitEvents: [],
  creditResolutions: [],
};

const detail: JobDetailRecord = {
  job: jobs.jobs[0] ?? null,
  allowanceEvents: [],
  resubmitEvents: [
    {
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      action: "authorize",
      reason: "operator_recovery",
      jobId: JOB,
      createdAt: "2026-11-07T00:00:01.000Z",
    },
    {
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      action: "revoke",
      reason: "submission_budget_exhausted",
      jobId: JOB,
      createdAt: "2026-11-07T00:00:02.000Z",
    },
    {
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
      action: "consume",
      reason: "submission_committed",
      jobId: JOB,
      createdAt: "2026-11-07T00:00:03.000Z",
    },
  ],
  creditResolution: null,
};

function jobRecord(jobId: string, unresolved: boolean): TesterJobPage["jobs"][number] {
  return {
    jobId,
    userId: USER_A,
    createdAt: unresolved ? "2026-11-07T00:00:00.000Z" : "2026-11-06T00:00:00.000Z",
    status: unresolved ? "needs_review" : "failed",
    operation: "image-to-3d",
    aiModel: "meshy-7.1",
    imageSlots: ["front"],
    allowanceState: unresolved ? "reserved" : "released",
    reservedCredits: 30,
    consumedCredits: unresolved ? null : 0,
    quotaState: unresolved ? "reserved" : "released",
    errorClass: unresolved ? "credit_unreported" : "invalid_output",
    providerStatus: unresolved ? "SUCCEEDED" : null,
    providerTaskConfirmed: unresolved,
    providerCreditReview: unresolved ? "unreported" : "reported",
    savedAssetStatus: "not_saved",
    unresolved,
    profile: profile(),
  };
}

function profile() {
  return {
    operation: "image-to-3d" as const,
    aiModel: "meshy-7.1" as const,
    geometryResolution: "standard",
    shouldTexture: true,
    textureModel: "meshy-7",
    textureResolution: "2k",
    enablePbr: false,
    imageEnhancement: true,
    shouldRemesh: false,
    topology: "triangle",
    targetPolycount: 30000,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
