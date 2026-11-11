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
  assert.match(empty, new RegExp(escapeRegExp(FURNITURE_GENERATION_WORKER_STATUS)));
  assert.match(empty, /Database live_enabled/);
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
      }],
      resubmitEvents: [],
      creditResolutions: [],
    },
    jobsPhase: "ready",
  }));
  assert.match(html, /No beta allowance on this account/);
  assert.match(html, /No generation jobs for this account/);
  assert.match(html, /Initial beta allowance/);
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
