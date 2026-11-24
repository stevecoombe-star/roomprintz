import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FURNITURE_GENERATION_WORKER_STATUS } from "./admin-dashboard";
import {
  accountAllowanceHealth,
  creditUtilization,
  formatUtilizationPercent,
  generationCapacity,
  paidSubmissionUtilization,
  STANDARD_GENERATION_CREDIT_ESTIMATE,
  utilization,
  type GenerationCapacity,
} from "./budget-health";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function budget(overrides: Partial<Parameters<typeof generationCapacity>[0]> = {}): Parameters<typeof generationCapacity>[0] {
  return {
    creditsConsumed: 0,
    creditsReserved: 0,
    creditCeiling: 500,
    remainingCreditBudget: 500,
    paidSubmissionsAuthorized: 20,
    paidSubmissionsUsed: 0,
    liveEnabled: true,
    generationAdmissionEnabled: true,
    maxConcurrent: 1,
    workerConfiguration: FURNITURE_GENERATION_WORKER_STATUS,
    ...overrides,
  };
}

test("utilization thresholds stay finite and do not treat a zero limit as healthy", () => {
  assert.equal(STANDARD_GENERATION_CREDIT_ESTIMATE, 30);
  const cases = [
    [0, 100, "healthy", "0%"],
    [50, 100, "healthy", "50%"],
    [799, 1000, "healthy", "79.9%"],
    [800, 1000, "warning", "80%"],
    [999, 1000, "warning", "99.9%"],
    [100, 100, "exhausted", "100%"],
    [150, 100, "exceeded", "150%"],
  ] as const;
  for (const [used, limit, kind, percent] of cases) {
    const measured = utilization(used, limit);
    assert.equal(measured.kind, kind, `${used}/${limit}`);
    assert.equal(formatUtilizationPercent(measured.percent ?? 0), percent);
    assert.ok(measured.percent != null && measured.percent > 100 ? measured.barPercent === 100 : measured.barPercent <= 100);
  }
  const unset = utilization(0, 0);
  assert.equal(unset.kind, "unavailable");
  assert.equal(unset.label, "No capacity");
  assert.equal(unset.percent, null);
  assert.notEqual(unset.kind, "healthy");
  const overEmpty = utilization(30, 0);
  assert.equal(overEmpty.kind, "exceeded");
  assert.equal(overEmpty.percent, null);
  assert.equal(overEmpty.barPercent, 100);
  assert.equal(utilization(Number.NaN, 10).kind, "unavailable");
});

test("reserved credits and reserved tester allowance count toward utilization", () => {
  const credits = creditUtilization({ creditsConsumed: 200, creditsReserved: 30, creditCeiling: 500 });
  assert.equal(credits.kind, "healthy");
  assert.equal(credits.used, 230);
  assert.equal(formatUtilizationPercent(credits.percent ?? 0), "46%");
  const allowance = accountAllowanceHealth({
    enabled: true,
    authorizedGenerations: 10,
    consumedGenerations: 5,
    reservedGenerations: 3,
  });
  assert.equal(allowance.statusLabel, "Warning");
  assert.equal(formatUtilizationPercent(allowance.utilization.percent ?? 0), "80%");
  const disabled = accountAllowanceHealth({
    enabled: false,
    authorizedGenerations: 10,
    consumedGenerations: 4,
    reservedGenerations: 0,
  });
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.statusLabel, "Disabled");
  assert.equal(disabled.utilization.kind, "healthy");
  const exhausted = accountAllowanceHealth({
    enabled: true,
    authorizedGenerations: 5,
    consumedGenerations: 4,
    reservedGenerations: 1,
  });
  assert.equal(exhausted.statusLabel, "Exhausted");
  assert.equal(formatUtilizationPercent(exhausted.utilization.percent ?? 0), "100%");
  const partner = accountAllowanceHealth({
    enabled: true,
    authorizedGenerations: 4,
    consumedGenerations: 1,
    reservedGenerations: 1,
  });
  assert.equal(partner.statusLabel, "Healthy");
  assert.equal(formatUtilizationPercent(partner.utilization.percent ?? 0), "50%");
});

test("capacity names the blocking budget and keeps admission separate from concurrency", () => {
  const paidBlocked = generationCapacity(budget({
    creditsConsumed: 100,
    creditsReserved: 0,
    creditCeiling: 500,
    remainingCreditBudget: 400,
    paidSubmissionsAuthorized: 20,
    paidSubmissionsUsed: 20,
  }));
  assert.equal(paidBlocked.estimatedGenerations, 0);
  assert.equal(paidBlocked.creditGenerations, 13);
  assert.equal(paidBlocked.paidAttemptGenerations, 0);
  assert.match(paidBlocked.headline, /Paid attempts exhausted/);
  assert.doesNotMatch(paidBlocked.headline, /Credit budget exhausted/);

  const creditsBlocked = generationCapacity(budget({
    creditsConsumed: 60,
    creditsReserved: 30,
    creditCeiling: 90,
    remainingCreditBudget: 0,
    paidSubmissionsAuthorized: 10,
    paidSubmissionsUsed: 2,
  }));
  assert.equal(creditsBlocked.estimatedGenerations, 0);
  assert.equal(creditsBlocked.paidAttemptGenerations, 8);
  assert.match(creditsBlocked.headline, /Credit budget exhausted/);
  assert.equal(creditUtilization({ creditsConsumed: 60, creditsReserved: 30, creditCeiling: 90 }).kind, "exhausted");

  const both = generationCapacity(budget({
    creditsConsumed: 60,
    creditsReserved: 0,
    creditCeiling: 60,
    remainingCreditBudget: 0,
    paidSubmissionsAuthorized: 10,
    paidSubmissionsUsed: 10,
  }));
  assert.match(both.headline, /Both budgets exhausted/);

  const exceeded = generationCapacity(budget({
    creditsConsumed: 80,
    creditsReserved: 40,
    creditCeiling: 100,
    remainingCreditBudget: -20,
    paidSubmissionsAuthorized: 10,
    paidSubmissionsUsed: 1,
  }));
  assert.equal(formatUtilizationPercent(creditUtilization({ creditsConsumed: 80, creditsReserved: 40, creditCeiling: 100 }).percent ?? 0), "120%");
  assert.match(exceeded.headline, /over its ceiling/);
  assert.equal(exceeded.estimatedGenerations, 0);

  const open = generationCapacity(budget({
    creditsConsumed: 0,
    creditsReserved: 0,
    creditCeiling: 0,
    remainingCreditBudget: 0,
    paidSubmissionsAuthorized: 0,
    paidSubmissionsUsed: 0,
  }));
  assert.match(open.headline, /No credit ceiling or paid-attempt authorization is set/);
  assert.equal(open.estimatedGenerations, 0);
  assert.notEqual(creditUtilization({ creditsConsumed: 0, creditsReserved: 0, creditCeiling: 0 }).kind, "healthy");
  assert.notEqual(paidSubmissionUtilization({ paidSubmissionsAuthorized: 0, paidSubmissionsUsed: 0 }).kind, "healthy");

  const admissionOff = generationCapacity(budget({
    liveEnabled: true,
    generationAdmissionEnabled: false,
  }));
  assert.match(admissionOff.headline, /Generation admission disabled/);
  assert.doesNotMatch(admissionOff.headline, /Capacity available/);
  assert.ok(admissionOff.creditGenerations > 0);

  const databaseOff = generationCapacity(budget({
    liveEnabled: false,
    generationAdmissionEnabled: true,
  }));
  assert.match(databaseOff.headline, /Database admission is off/);
  assert.match(databaseOff.headline, /could still allow/);
  assert.doesNotMatch(databaseOff.headline, /Capacity available/);

  const ready = generationCapacity(budget({
    creditsConsumed: 200,
    creditsReserved: 30,
    creditCeiling: 500,
    remainingCreditBudget: 270,
    paidSubmissionsAuthorized: 20,
    paidSubmissionsUsed: 2,
  }));
  assert.equal(ready.creditsPerGeneration, 30);
  assert.equal(ready.creditGenerations, 9);
  assert.equal(ready.paidAttemptGenerations, 18);
  assert.equal(ready.estimatedGenerations, 9);
  assert.match(ready.headline, /Capacity available/);
  assert.match(ready.headline, /credit budget is the tighter limit/);
  assert.match(ready.concurrency, /not reported/);
  assert.doesNotMatch(ready.headline, /fully operational|slot is in use|worker is operational/i);
  assert.equal(ready.worker, FURNITURE_GENERATION_WORKER_STATUS);
  assert.match(ready.consequence, /not verified/);
});

test("the displayed estimate matches the stored remaining credit budget", () => {
  const sample = budget({
    creditsConsumed: 40,
    creditsReserved: 30,
    creditCeiling: 130,
    remainingCreditBudget: 60,
    paidSubmissionsAuthorized: 4,
    paidSubmissionsUsed: 1,
  });
  const capacity: GenerationCapacity = generationCapacity(sample);
  const fromStored = Math.min(
    Math.max(0, Math.floor(sample.remainingCreditBudget / STANDARD_GENERATION_CREDIT_ESTIMATE)),
    Math.max(0, sample.paidSubmissionsAuthorized - sample.paidSubmissionsUsed),
  );
  assert.equal(capacity.estimatedGenerations, fromStored);
  assert.equal(capacity.estimatedGenerations, 2);
});

test("budget and tester saves publish the confirmed values before the success message", () => {
  const source = readFileSync(join(ROOT, "app/admin/furniture-generation/FurnitureGenerationDashboard.tsx"), "utf8");
  const saveBudget = source.slice(source.indexOf("async function saveBudget"), source.indexOf("async function approveTester"));
  assert.ok(saveBudget.indexOf("await refreshDashboard(null)") < saveBudget.indexOf("The beta budget was saved."));
  assert.doesNotMatch(saveBudget.slice(0, saveBudget.indexOf("await sendJson")), /setOverview\(/);
  const testerStart = source.indexOf("async function saveTester");
  const saveTester = source.slice(testerStart, source.indexOf("\n  return (", testerStart));
  assert.ok(saveTester.indexOf("await refreshDashboard") < saveTester.indexOf("Tester access was saved."));
});
