/**
 * AFC-SR1 S1 — research-only solver certification.
 *
 * This module is deliberately a consumer of S0: it independently enumerates
 * and locally refines cells, but never changes solver inputs or authority.
 */
import type { AfcSr1SolverHandoffV1 } from "./afc-sr1-semantic-prior";
import {
  DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG,
  evaluateAfcSr1JointCandidate,
  fovCoarseTicks,
  fovRefineTicks,
  rankAfcSr1JointSolverCandidates,
  ratioCoarseTicks,
  ratioRefineTicks,
  seamTSamplesForHypothesis,
  solveAfcSr1JointCalibration,
  type AfcSr1JointSolverCandidateV1,
  type AfcSr1JointSolverConfigV1,
  type AfcSr1JointSolverEvaluationContextV1,
  type AfcSr1JointSolverResultV1,
  type AfcSr1SolverHypothesisV1,
} from "./afc-sr1-joint-solver";

export const AFC_SR1_SOLVER_CERTIFICATION_VERSION =
  "afc-sr1-solver-certification/v1" as const;

export type AfcSr1SearchConvergenceVerdictV1 =
  | "certified"
  | "refinement_missed_better_basin"
  | "global_grid_too_coarse"
  | "domain_boundary_hit"
  | "nondeterministic"
  | "no_reference_solution"
  | "ambiguous_geometry";

export type AfcSr1SearchIntegrityStatusV1 = "certified" | "failed";
export type AfcSr1Gt0ParameterRecoveryStatusV1 =
  | "matched"
  | "diverged"
  | "not_applicable";

type CandidateSummary = Readonly<{
  hypothesis: "none" | "NL" | "NR";
  seamT: number | null;
  widthDepthRatio: number;
  verticalFovDeg: number;
  cvAvgPx: number;
  cvMaxPx: number;
  applySafe: boolean;
}>;

export type AfcSr1SolverCertificationOracleV1 = Readonly<{
  hypothesis: "none" | "NL" | "NR";
  seamT: number | null;
  widthDepthRatio: number;
  verticalFovDeg: number;
  residuals?: Readonly<{ cvAvgPx: number; cvMaxPx: number; label: string }>;
}>;

export type AfcSr1TopKRefinementSeedV1 = Readonly<{
  coarse: CandidateSummary;
  refined: CandidateSummary | null;
}>;

export type AfcSr1TopKReferenceV1 = Readonly<{
  k: number;
  perHypothesis: Readonly<Record<"none" | "NL" | "NR", Readonly<{
    coarseCandidateCount: number;
    topSeeds: readonly AfcSr1TopKRefinementSeedV1[];
    bestRefined: CandidateSummary | null;
  }>>>;
  best: CandidateSummary | null;
  productionMatchesReference: boolean | null;
  oneRefineStepResidualAllowance: number | null;
}>;

export type AfcSr1SolverCertificationResultV1 = Readonly<{
  schemaVersion: "afc-sr1-solver-certification/v1";
  fixtureId: string;
  solverConfigDigest: string;
  solverDigest: string | null;
  oracle: Readonly<{
    hypothesis: "none" | "NL" | "NR";
    seamT: number | null;
    widthDepthRatio: number;
    verticalFovDeg: number;
    residuals?: Readonly<{ cvAvgPx: number; cvMaxPx: number; label: string }>;
  }> | null;
  recovered: Readonly<{
    status: string;
    hypothesis: "none" | "NL" | "NR" | null;
    seamT: number | null;
    widthDepthRatio: number | null;
    verticalFovDeg: number | null;
    cvAvgPx: number | null;
    cvMaxPx: number | null;
    applySafe: boolean | null;
  }>;
  hypothesisMatch: boolean | null;
  seamTError: number | null;
  ratioError: number | null;
  fovErrorDeg: number | null;
  withinRefineTolerance: boolean | null;
  residualComparison: Readonly<{
    recoveredCvAvg: number | null;
    referenceCvAvg: number | null;
    referenceLabel: string;
    acceptable: boolean | null;
  }> | null;
  convergence: AfcSr1SearchConvergenceVerdictV1;
  searchIntegrity: AfcSr1SearchIntegrityStatusV1;
  gt0ParameterRecovery: AfcSr1Gt0ParameterRecoveryStatusV1;
  physicalSelectionConstraintAvailable: false;
  deterministicReplay: boolean;
  searchCounts: Readonly<{
    evaluated: number;
    rejected: number;
    applySafe: number;
    refineEvaluated: number;
  }> | null;
  certificationStatus: "pass" | "fail" | "informational";
}>;

export type AfcSr1SolverRuntimeCharacterizationV1 = Readonly<{
  runs: number;
  minMs: number;
  medianMs: number;
  maxMs: number;
  deterministicCounts: boolean;
}>;

const HYPOTHESES = ["none", "NL", "NR"] as const;
const EPSILON = 1e-12;

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function summary(candidate: AfcSr1JointSolverCandidateV1): CandidateSummary {
  return freeze({
    hypothesis: candidate.cell.hypothesis,
    seamT: candidate.cell.seamT,
    widthDepthRatio: candidate.cell.widthDepthRatio,
    verticalFovDeg: candidate.cell.verticalFovDeg,
    cvAvgPx: candidate.camera.cvAvgPx,
    cvMaxPx: candidate.camera.cvMaxPx,
    applySafe: candidate.applyGateObservability.available,
  });
}

function winner(result: AfcSr1JointSolverResultV1): AfcSr1JointSolverCandidateV1 | null {
  if (result.status === "solved") return result.candidate;
  return result.status === "invalid_input" ? null : result.bestValidCandidate;
}

function summaryMatches(candidate: AfcSr1JointSolverCandidateV1, reference: CandidateSummary): boolean {
  const actual = summary(candidate);
  return actual.hypothesis === reference.hypothesis &&
    actual.seamT === reference.seamT &&
    actual.widthDepthRatio === reference.widthDepthRatio &&
    actual.verticalFovDeg === reference.verticalFovDeg &&
    actual.cvAvgPx === reference.cvAvgPx &&
    actual.cvMaxPx === reference.cvMaxPx &&
    actual.applySafe === reference.applySafe;
}

function localSeamTicks(config: AfcSr1JointSolverConfigV1, center: number): readonly number[] {
  const min = Math.max(config.seamSearch.globalMinExclusive, center - config.seamSearch.coarseStep);
  const max = Math.min(config.seamSearch.globalMaxExclusive, center + config.seamSearch.coarseStep);
  const values: number[] = [];
  const count = Math.round((max - min) / config.seamSearch.refineStep);
  for (let index = 0; index <= count; index += 1) {
    const value = Number((min + index * config.seamSearch.refineStep).toPrecision(14));
    if (value > config.seamSearch.globalMinExclusive + EPSILON &&
        value < config.seamSearch.globalMaxExclusive - EPSILON) values.push(value);
  }
  return freeze([...new Set(values)].sort((left, right) => left - right));
}

function evaluateCells(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  config: AfcSr1JointSolverConfigV1;
  hypothesis: AfcSr1SolverHypothesisV1;
  seams: readonly (number | null)[];
  ratios: readonly number[];
  fovs: readonly number[];
}>): readonly AfcSr1JointSolverCandidateV1[] {
  const candidates: AfcSr1JointSolverCandidateV1[] = [];
  for (const seamT of input.seams) {
    for (const widthDepthRatio of input.ratios) {
      for (const verticalFovDeg of input.fovs) {
        const result = evaluateAfcSr1JointCandidate({
          solverHandoff: input.solverHandoff,
          evaluationContext: input.evaluationContext,
          config: input.config,
          cell: freeze({ hypothesis: input.hypothesis, seamT, widthDepthRatio, verticalFovDeg }),
        });
        if (result.ok) candidates.push(result.candidate);
      }
    }
  }
  return candidates;
}

/**
 * Independent coarse enumeration. It deliberately does not observe S0's
 * diagnostics or coarse seed choices. It reproduces only the public legal
 * seam sample policy, then evaluates and ranks cells independently.
 */
export function enumerateAfcSr1IndependentCoarse(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  config?: AfcSr1JointSolverConfigV1;
}>): Readonly<Record<"none" | "NL" | "NR", readonly AfcSr1JointSolverCandidateV1[]>> {
  const config = input.config ?? DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG;
  const ratios = ratioCoarseTicks(config);
  const fovs = fovCoarseTicks(config);
  return freeze({
    none: freeze(evaluateCells({ ...input, config, hypothesis: "none", seams: [null], ratios, fovs })),
    NL: freeze(evaluateCells({
      ...input, config, hypothesis: "NL",
      seams: seamTSamplesForHypothesis(input.solverHandoff, "NL", config), ratios, fovs,
    })),
    NR: freeze(evaluateCells({
      ...input, config, hypothesis: "NR",
      seams: seamTSamplesForHypothesis(input.solverHandoff, "NR", config), ratios, fovs,
    })),
  });
}

/** Independently refines one coarse seed using only public S0 cell APIs. */
export function refineAfcSr1IndependentSeed(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  seed: AfcSr1JointSolverCandidateV1;
  config?: AfcSr1JointSolverConfigV1;
}>): AfcSr1JointSolverCandidateV1 | null {
  const config = input.config ?? DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG;
  const cells = evaluateCells({
    solverHandoff: input.solverHandoff,
    evaluationContext: input.evaluationContext,
    config,
    hypothesis: input.seed.cell.hypothesis,
    seams: input.seed.cell.hypothesis === "none" ? [null] : localSeamTicks(config, input.seed.cell.seamT!),
    ratios: ratioRefineTicks(config, input.seed.cell.widthDepthRatio),
    fovs: fovRefineTicks(config, input.seed.cell.verticalFovDeg),
  });
  return rankAfcSr1JointSolverCandidates(cells)[0] ?? null;
}

function residualAllowance(input: Readonly<{
  best: AfcSr1JointSolverCandidateV1;
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  config: AfcSr1JointSolverConfigV1;
}>): number {
  const cells = evaluateCells({
    solverHandoff: input.solverHandoff,
    evaluationContext: input.evaluationContext,
    config: input.config,
    hypothesis: input.best.cell.hypothesis,
    seams: input.best.cell.hypothesis === "none" ? [null] : localSeamTicks(input.config, input.best.cell.seamT!),
    ratios: ratioRefineTicks(input.config, input.best.cell.widthDepthRatio),
    fovs: fovRefineTicks(input.config, input.best.cell.verticalFovDeg),
  });
  const oneStep = cells.filter(candidate =>
    Math.abs(candidate.cell.widthDepthRatio - input.best.cell.widthDepthRatio) <= input.config.ratioSearch.refineStep + EPSILON &&
    Math.abs(candidate.cell.verticalFovDeg - input.best.cell.verticalFovDeg) <= input.config.fovSearch.refineStepDeg + EPSILON &&
    (candidate.cell.seamT === null || Math.abs(candidate.cell.seamT - input.best.cell.seamT!) <= input.config.seamSearch.refineStep + EPSILON)
  );
  return Math.max(0, ...oneStep.map(candidate => candidate.camera.cvAvgPx - input.best.camera.cvAvgPx));
}

export function buildAfcSr1TopKReference(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  productionResult: AfcSr1JointSolverResultV1;
  config?: AfcSr1JointSolverConfigV1;
  k?: number;
}>): AfcSr1TopKReferenceV1 {
  const config = input.config ?? DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG;
  const k = input.k ?? 5;
  const coarse = enumerateAfcSr1IndependentCoarse({ ...input, config });
  const perHypothesis = {} as Record<"none" | "NL" | "NR", {
    coarseCandidateCount: number; topSeeds: readonly AfcSr1TopKRefinementSeedV1[]; bestRefined: CandidateSummary | null;
  }>;
  const refined: AfcSr1JointSolverCandidateV1[] = [];
  for (const hypothesis of HYPOTHESES) {
    const top = rankAfcSr1JointSolverCandidates(coarse[hypothesis]).slice(0, k);
    const localRefined = top.map(seed =>
      refineAfcSr1IndependentSeed({ ...input, config, seed })
    );
    for (const candidate of localRefined) if (candidate) refined.push(candidate);
    const seeds = top.map((seed, index) => freeze({
      coarse: summary(seed),
      refined: localRefined[index] ? summary(localRefined[index]!) : null,
    }));
    const localBest = rankAfcSr1JointSolverCandidates(
      localRefined.filter((candidate): candidate is AfcSr1JointSolverCandidateV1 => candidate !== null)
    )[0] ?? null;
    perHypothesis[hypothesis] = freeze({
      coarseCandidateCount: coarse[hypothesis].length,
      topSeeds: freeze(seeds),
      bestRefined: localBest ? summary(localBest) : null,
    });
  }
  // Reconstitute compact summaries into a ranking-compatible, deterministic
  // result by retaining the independently evaluated candidate collection.
  const best = rankAfcSr1JointSolverCandidates(refined)[0] ?? null;
  const productionWinner = winner(input.productionResult);
  return freeze({
    k,
    perHypothesis: freeze(perHypothesis),
    best: best ? summary(best) : null,
    productionMatchesReference: productionWinner && best ? summaryMatches(productionWinner, summary(best)) : null,
    oneRefineStepResidualAllowance: best ? residualAllowance({
      best, solverHandoff: input.solverHandoff, evaluationContext: input.evaluationContext, config,
    }) : null,
  });
}

function replayEqual(left: AfcSr1JointSolverResultV1, right: AfcSr1JointSolverResultV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundaryHit(candidate: AfcSr1JointSolverCandidateV1, config: AfcSr1JointSolverConfigV1): boolean {
  const cell = candidate.cell;
  return cell.widthDepthRatio <= config.ratioSearch.min + EPSILON ||
    cell.widthDepthRatio >= config.ratioSearch.max - EPSILON ||
    cell.verticalFovDeg <= config.fovSearch.minDeg + EPSILON ||
    cell.verticalFovDeg >= config.fovSearch.maxDeg - EPSILON ||
    (cell.seamT !== null && (
      cell.seamT <= config.seamSearch.globalMinExclusive + config.seamSearch.refineStep + EPSILON ||
      cell.seamT >= config.seamSearch.globalMaxExclusive - config.seamSearch.refineStep - EPSILON
    ));
}

export function certifyAfcSr1JointSolve(input: Readonly<{
  fixtureId: string;
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  config?: AfcSr1JointSolverConfigV1;
  oracle?: AfcSr1SolverCertificationOracleV1 | null;
  reference?: AfcSr1TopKReferenceV1 | null;
}>): AfcSr1SolverCertificationResultV1 {
  const config = input.config ?? DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG;
  // The oracle is deliberately not read until after this complete solve.
  const solved = solveAfcSr1JointCalibration({
    solverHandoff: input.solverHandoff, evaluationContext: input.evaluationContext, config,
  });
  const replay = solveAfcSr1JointCalibration({
    solverHandoff: input.solverHandoff, evaluationContext: input.evaluationContext, config,
  });
  const deterministicReplay = replayEqual(solved, replay);
  const recoveredCandidate = winner(solved);
  const recovered = freeze({
    status: solved.status,
    hypothesis: recoveredCandidate?.cell.hypothesis ?? null,
    seamT: recoveredCandidate?.cell.seamT ?? null,
    widthDepthRatio: recoveredCandidate?.cell.widthDepthRatio ?? null,
    verticalFovDeg: recoveredCandidate?.cell.verticalFovDeg ?? null,
    cvAvgPx: recoveredCandidate?.camera.cvAvgPx ?? null,
    cvMaxPx: recoveredCandidate?.camera.cvMaxPx ?? null,
    applySafe: recoveredCandidate?.applyGateObservability.available ?? null,
  });
  const oracle = input.oracle ?? null;
  const hypothesisMatch = oracle && recovered.hypothesis ? oracle.hypothesis === recovered.hypothesis : null;
  const seamTError = oracle && oracle.seamT !== null && recovered.seamT !== null ? Math.abs(oracle.seamT - recovered.seamT) : null;
  const ratioError = oracle && recovered.widthDepthRatio !== null ? Math.abs(oracle.widthDepthRatio - recovered.widthDepthRatio) : null;
  const fovErrorDeg = oracle && recovered.verticalFovDeg !== null ? Math.abs(oracle.verticalFovDeg - recovered.verticalFovDeg) : null;
  const withinRefineTolerance = oracle === null ? null :
    hypothesisMatch === true &&
    (oracle.seamT === null || (seamTError !== null && seamTError <= config.seamSearch.refineStep + EPSILON)) &&
    ratioError !== null && ratioError <= config.ratioSearch.refineStep + EPSILON &&
    fovErrorDeg !== null && fovErrorDeg <= config.fovSearch.refineStepDeg + EPSILON;
  const reference = input.reference ?? null;
  const residualComparison = reference ? freeze({
    recoveredCvAvg: recovered.cvAvgPx,
    referenceCvAvg: reference.best?.cvAvgPx ?? null,
    referenceLabel: `independent_top_${reference.k}_refinement`,
    acceptable: recovered.cvAvgPx !== null && reference.best !== null && reference.oneRefineStepResidualAllowance !== null
      ? recovered.cvAvgPx <= reference.best.cvAvgPx + reference.oneRefineStepResidualAllowance + EPSILON
      : null,
  }) : null;
  const convergence: AfcSr1SearchConvergenceVerdictV1 =
    !deterministicReplay ? "nondeterministic" :
    !reference?.best ? "no_reference_solution" :
    reference.productionMatchesReference === false ? "refinement_missed_better_basin" :
    recoveredCandidate && boundaryHit(recoveredCandidate, config) ? "domain_boundary_hit" :
    "certified";
  const searchCounts = solved.status === "invalid_input" ? null : freeze({
    evaluated: solved.diagnostics.evaluatedCellCount,
    rejected: solved.diagnostics.rejectedCellCount,
    applySafe: solved.diagnostics.applySafeCellCount,
    refineEvaluated: solved.diagnostics.refinementSummary.evaluatedCellCount,
  });
  const searchIntegrityCertified =
    solved.status === "solved" &&
    recovered.applySafe === true &&
    (oracle === null || hypothesisMatch === true) &&
    (residualComparison?.acceptable !== false) &&
    convergence === "certified";
  const gt0ParameterRecovery: AfcSr1Gt0ParameterRecoveryStatusV1 =
    oracle === null ? "not_applicable" :
    withinRefineTolerance === true ? "matched" : "diverged";
  return freeze({
    schemaVersion: AFC_SR1_SOLVER_CERTIFICATION_VERSION,
    fixtureId: input.fixtureId,
    solverConfigDigest: solved.status === "invalid_input" ? "" : solved.solverConfigDigest,
    solverDigest: solved.status === "invalid_input" ? null : solved.solverDigest,
    oracle,
    recovered,
    hypothesisMatch,
    seamTError,
    ratioError,
    fovErrorDeg,
    withinRefineTolerance,
    residualComparison,
    convergence,
    searchIntegrity: searchIntegrityCertified ? "certified" : "failed",
    gt0ParameterRecovery,
    physicalSelectionConstraintAvailable: false as const,
    deterministicReplay,
    searchCounts,
    certificationStatus: searchIntegrityCertified ? "pass" : "fail",
  });
}

export function characterizeAfcSr1JointSolveRuntime(input: Readonly<{
  solverHandoff: AfcSr1SolverHandoffV1;
  evaluationContext: AfcSr1JointSolverEvaluationContextV1;
  config?: AfcSr1JointSolverConfigV1;
  runs?: number;
}>): AfcSr1SolverRuntimeCharacterizationV1 {
  const config = input.config ?? DEFAULT_AFC_SR1_JOINT_SOLVER_CONFIG;
  const runs = input.runs ?? 3;
  const durations: number[] = [];
  const counts: string[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const result = solveAfcSr1JointCalibration({
      solverHandoff: input.solverHandoff, evaluationContext: input.evaluationContext, config,
    });
    durations.push(performance.now() - started);
    counts.push(result.status === "invalid_input" ? "invalid" : JSON.stringify(result.diagnostics));
  }
  const sorted = [...durations].sort((left, right) => left - right);
  return freeze({
    runs,
    minMs: sorted[0] ?? 0,
    medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    deterministicCounts: new Set(counts).size === 1,
  });
}
