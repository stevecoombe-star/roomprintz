"use client";

import type {
  AllowanceEventRecord,
  BetaTesterRecord,
  CreditResolutionRecord,
  DashboardOverview,
  GenerationJobRecord,
  JobDetailRecord,
  ResubmitEventRecord,
  TesterJobPage,
  TesterPage,
} from "@/lib/vibode-furniture/generation/admin-dashboard";

export type FurnitureDashboardPhase = "loading" | "error" | "ready";

export type FurnitureGenerationDashboardViewProps = {
  phase: FurnitureDashboardPhase;
  message: string | null;
  notice: string | null;
  overview: DashboardOverview | null;
  testers: TesterPage | null;
  testerQuery: string;
  jobs: TesterJobPage | null;
  jobsPhase: "idle" | FurnitureDashboardPhase;
  jobsMessage: string | null;
  detail: JobDetailRecord | null;
  detailPhase: "idle" | FurnitureDashboardPhase;
  detailMessage: string | null;
  onQueryChange?: (value: string) => void;
  onFilter?: () => void;
  onTesterPage?: (offset: number) => void;
  onOpenTester?: (userId: string) => void;
  onJobPage?: (offset: number) => void;
  onOpenJob?: (jobId: string) => void;
  approveEmail?: string;
  approveClassification?: "individual_beta" | "furniture_partner";
  approveAllowance?: string;
  approveEnabled?: boolean;
  approveReason?: string;
  approveConfirmed?: boolean;
  editUserId?: string | null;
  editClassification?: "individual_beta" | "furniture_partner";
  editAllowance?: string;
  editEnabled?: boolean;
  editReason?: string;
  editConfirmed?: boolean;
  managementMessage?: string | null;
  managementSaving?: boolean;
  onApproveEmail?: (value: string) => void;
  onApproveClassification?: (value: "individual_beta" | "furniture_partner") => void;
  onApproveAllowance?: (value: string) => void;
  onApproveEnabled?: (value: boolean) => void;
  onApproveReason?: (value: string) => void;
  onApproveConfirmed?: (value: boolean) => void;
  onApprove?: () => void;
  onManageTester?: (userId: string) => void;
  onEditClassification?: (value: "individual_beta" | "furniture_partner") => void;
  onEditAllowance?: (value: string) => void;
  onEditEnabled?: (value: boolean) => void;
  onEditReason?: (value: string) => void;
  onEditConfirmed?: (value: boolean) => void;
  onSaveTester?: () => void;
};

const METRICS: Array<[string, keyof DashboardOverview]> = [
  ["Approved beta accounts", "approvedAccounts"],
  ["Enabled beta accounts", "enabledAccounts"],
  ["Total authorized generations", "authorizedGenerations"],
  ["Reserved generations", "reservedGenerations"],
  ["Consumed generations", "consumedGenerations"],
  ["Remaining generations", "remainingGenerations"],
  ["Paid submission attempts authorized", "paidSubmissionsAuthorized"],
  ["Paid submission attempts used", "paidSubmissionsUsed"],
  ["Confirmed provider tasks", "confirmedProviderTasks"],
  ["Usable candidates generated", "usableCandidates"],
  ["Permanently saved models", "permanentlySavedModels"],
  ["Provider failures", "providerFailures"],
  ["Meshy credits reserved", "creditsReserved"],
  ["Meshy credits consumed", "creditsConsumed"],
  ["Remaining global credit budget", "remainingCreditBudget"],
  ["Unresolved provider-credit exposure", "unresolvedProviderCreditExposure"],
];

export function FurnitureGenerationDashboardView(props: FurnitureGenerationDashboardViewProps) {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="space-y-2">
          <a href="/admin" className="text-xs text-slate-400 hover:text-emerald-200">
            Back to Admin
          </a>
          <h1 className="text-2xl font-semibold tracking-tight">AI Furniture Generation</h1>
          <p className="text-sm text-slate-400">Beta Access & Usage Management</p>
        </header>

        {props.phase === "loading" ? (
          <p className="text-sm text-slate-300" aria-live="polite">
            Loading AI furniture generation status.
          </p>
        ) : null}

        {props.phase === "error" ? (
          <p className="rounded-2xl border border-rose-900/70 bg-rose-950/40 p-4 text-sm text-rose-200" aria-live="polite">
            {props.message ?? "The furniture generation dashboard could not be loaded."}
          </p>
        ) : null}

        {props.phase === "ready" && props.notice ? (
          <p className="rounded-2xl border border-rose-900/70 bg-rose-950/40 p-4 text-sm text-rose-200" aria-live="polite">
            {props.notice}
          </p>
        ) : null}

        {props.phase === "ready" && props.overview ? (
          <>
            <Overview overview={props.overview} />
            <ProductionStatus overview={props.overview} />
            <TesterSection
              overview={props.overview}
              testers={props.testers}
              testerQuery={props.testerQuery}
              onQueryChange={props.onQueryChange}
              onFilter={props.onFilter}
              onTesterPage={props.onTesterPage}
              onOpenTester={props.onOpenTester}
              approveEmail={props.approveEmail ?? ""}
              approveClassification={props.approveClassification ?? "individual_beta"}
              approveAllowance={props.approveAllowance ?? "1"}
              approveEnabled={props.approveEnabled ?? true}
              approveReason={props.approveReason ?? ""}
              approveConfirmed={props.approveConfirmed ?? false}
              editUserId={props.editUserId ?? null}
              editClassification={props.editClassification ?? "individual_beta"}
              editAllowance={props.editAllowance ?? ""}
              editEnabled={props.editEnabled ?? true}
              editReason={props.editReason ?? ""}
              editConfirmed={props.editConfirmed ?? false}
              managementMessage={props.managementMessage ?? null}
              managementSaving={props.managementSaving ?? false}
              onApproveEmail={props.onApproveEmail}
              onApproveClassification={props.onApproveClassification}
              onApproveAllowance={props.onApproveAllowance}
              onApproveEnabled={props.onApproveEnabled}
              onApproveReason={props.onApproveReason}
              onApproveConfirmed={props.onApproveConfirmed}
              onApprove={props.onApprove}
              onManageTester={props.onManageTester}
              onEditClassification={props.onEditClassification}
              onEditAllowance={props.onEditAllowance}
              onEditEnabled={props.onEditEnabled}
              onEditReason={props.onEditReason}
              onEditConfirmed={props.onEditConfirmed}
              onSaveTester={props.onSaveTester}
            />
            <HistorySection
              jobs={props.jobs}
              jobsPhase={props.jobsPhase}
              jobsMessage={props.jobsMessage}
              detail={props.detail}
              detailPhase={props.detailPhase}
              detailMessage={props.detailMessage}
              onJobPage={props.onJobPage}
              onOpenJob={props.onOpenJob}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}

function Overview({ overview }: { overview: DashboardOverview }) {
  return (
    <section className="space-y-3" aria-label="Global overview">
      <h2 className="text-base font-medium text-slate-100">Global overview</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map(([label, key]) => {
          const value = overview[key];
          const amount = typeof value === "number" ? value : 0;
          const exposure = key === "unresolvedProviderCreditExposure" && amount > 0;
          return (
            <article
              key={key}
              className={`rounded-2xl border p-3 ${exposure ? "border-amber-700/80 bg-amber-950/30" : "border-slate-800 bg-slate-900/70"}`}
            >
              <h3 className="text-xs text-slate-400">{label}</h3>
              <p className={`mt-2 text-lg font-medium ${amount < 0 || exposure ? "text-amber-200" : "text-slate-50"}`}>
                {formatCount(amount)}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProductionStatus({ overview }: { overview: DashboardOverview }) {
  const rows = [
    ["Database live_enabled", overview.liveEnabled ? "On" : "Off"],
    ["Generation environment admission", overview.generationAdmissionEnabled ? "On" : "Off"],
    ["Global paid-submission allowance", formatCount(overview.paidSubmissionsAuthorized)],
    ["Global credit ceiling", formatCount(overview.creditCeiling)],
    ["Concurrency limit", formatCount(overview.maxConcurrent)],
  ] as const;
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4" aria-label="Production safety status">
      <h2 className="text-base font-medium text-slate-100">Production safety status</h2>
      <p className="mt-1 text-xs text-slate-400">Read-only. This page cannot change generation, spending, or credentials.</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-800 px-3 py-2">
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="mt-1 text-sm text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-slate-200">{overview.workerConfiguration}</p>
    </section>
  );
}

function TesterSection(props: {
  overview: DashboardOverview;
  testers: TesterPage | null;
  testerQuery: string;
  onQueryChange?: (value: string) => void;
  onFilter?: () => void;
  onTesterPage?: (offset: number) => void;
  onOpenTester?: (userId: string) => void;
  approveEmail: string;
  approveClassification: "individual_beta" | "furniture_partner";
  approveAllowance: string;
  approveEnabled: boolean;
  approveReason: string;
  approveConfirmed: boolean;
  editUserId: string | null;
  editClassification: "individual_beta" | "furniture_partner";
  editAllowance: string;
  editEnabled: boolean;
  editReason: string;
  editConfirmed: boolean;
  managementMessage: string | null;
  managementSaving: boolean;
  onApproveEmail?: (value: string) => void;
  onApproveClassification?: (value: "individual_beta" | "furniture_partner") => void;
  onApproveAllowance?: (value: string) => void;
  onApproveEnabled?: (value: boolean) => void;
  onApproveReason?: (value: string) => void;
  onApproveConfirmed?: (value: boolean) => void;
  onApprove?: () => void;
  onManageTester?: (userId: string) => void;
  onEditClassification?: (value: "individual_beta" | "furniture_partner") => void;
  onEditAllowance?: (value: string) => void;
  onEditEnabled?: (value: boolean) => void;
  onEditReason?: (value: string) => void;
  onEditConfirmed?: (value: boolean) => void;
  onSaveTester?: () => void;
}) {
  const testers = props.testers;
  const empty = testers != null && testers.testers.length === 0;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-medium text-slate-100">Beta testers</h2>
          <p className="mt-1 text-xs text-slate-400">
            Approved accounts are allowance rows. An account without a row is outside the beta.
          </p>
        </div>
        <form
          method="get"
          action="/admin/furniture-generation"
          className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            props.onFilter?.();
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-slate-400">Filter accounts</span>
            <input
              aria-label="Filter beta accounts"
              value={props.testerQuery}
              onChange={(event) => props.onQueryChange?.(event.target.value)}
              placeholder="Email or account id"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 sm:w-72"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-emerald-400/80 hover:text-emerald-200"
          >
            Filter
          </button>
        </form>
      </div>
      <TesterManagement {...props} />

      {testers == null ? (
        <p className="text-sm text-slate-300">Tester records are unavailable.</p>
      ) : empty ? (
        <p className="text-sm text-slate-300">
          {props.testerQuery.trim()
            ? "No approved beta accounts match this filter."
            : "No approved beta accounts."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="px-2 py-2 font-medium">Account</th>
                <th className="px-2 py-2 font-medium">Classification</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Authorized</th>
                <th className="px-2 py-2 font-medium">Reserved</th>
                <th className="px-2 py-2 font-medium">Consumed</th>
                <th className="px-2 py-2 font-medium">Remaining</th>
                <th className="px-2 py-2 font-medium">Updated</th>
                <th className="px-2 py-2 font-medium">History</th>
              </tr>
            </thead>
            <tbody>
              {testers.testers.map((tester) => (
                <TesterRow key={tester.userId} tester={tester} onOpen={props.onOpenTester} onManage={props.onManageTester} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {testers ? (
        <PageControls
          offset={testers.offset}
          limit={testers.limit}
          total={testers.total}
          count={testers.testers.length}
          onPage={props.onTesterPage}
        />
      ) : null}

      <HistoricalJobs overview={props.overview} onOpenTester={props.onOpenTester} />
      <DeletedAudits overview={props.overview} onOpenTester={props.onOpenTester} />
    </section>
  );
}

function TesterManagement(props: {
  testers: TesterPage | null;
  approveEmail: string;
  approveClassification: "individual_beta" | "furniture_partner";
  approveAllowance: string;
  approveEnabled: boolean;
  approveReason: string;
  approveConfirmed: boolean;
  editUserId: string | null;
  editClassification: "individual_beta" | "furniture_partner";
  editAllowance: string;
  editEnabled: boolean;
  editReason: string;
  editConfirmed: boolean;
  managementMessage: string | null;
  managementSaving: boolean;
  onApproveEmail?: (value: string) => void;
  onApproveClassification?: (value: "individual_beta" | "furniture_partner") => void;
  onApproveAllowance?: (value: string) => void;
  onApproveEnabled?: (value: boolean) => void;
  onApproveReason?: (value: string) => void;
  onApproveConfirmed?: (value: boolean) => void;
  onApprove?: () => void;
  onEditClassification?: (value: "individual_beta" | "furniture_partner") => void;
  onEditAllowance?: (value: string) => void;
  onEditEnabled?: (value: boolean) => void;
  onEditReason?: (value: string) => void;
  onEditConfirmed?: (value: boolean) => void;
  onSaveTester?: () => void;
}) {
  const editing = props.testers?.testers.find((tester) => tester.userId === props.editUserId) ?? null;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <form
        className="space-y-3 rounded-xl border border-slate-800 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          props.onApprove?.();
        }}
      >
        <h3 className="text-sm font-medium text-slate-100">Approve an existing account</h3>
        <p className="text-xs text-slate-400">Exact email. Production switches and spending limits stay unchanged.</p>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Exact email
          <input
            aria-label="Exact email"
            value={props.approveEmail}
            onChange={(event) => props.onApproveEmail?.(event.target.value)}
            className={fieldClass}
          />
        </label>
        <ClassificationField
          label="Initial classification"
          value={props.approveClassification}
          onChange={props.onApproveClassification}
        />
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Initial generation allowance
          <input
            aria-label="Initial generation allowance"
            inputMode="numeric"
            value={props.approveAllowance}
            onChange={(event) => props.onApproveAllowance?.(event.target.value)}
            className={fieldClass}
          />
        </label>
        <AccessField checked={props.approveEnabled} onChange={props.onApproveEnabled} />
        <ReasonField label="Approval reason" value={props.approveReason} onChange={props.onApproveReason} />
        <ConfirmField checked={props.approveConfirmed} onChange={props.onApproveConfirmed} />
        <button type="submit" disabled={props.managementSaving || !props.approveConfirmed} className={buttonClass}>
          Approve account
        </button>
      </form>
      <form
        className="space-y-3 rounded-xl border border-slate-800 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSaveTester?.();
        }}
      >
        <h3 className="text-sm font-medium text-slate-100">Adjust an approved tester</h3>
        {editing ? (
          <p className="text-xs text-slate-400">
            {editing.email ?? editing.userId} · reserved {formatCount(editing.reservedGenerations)} · consumed {formatCount(editing.consumedGenerations)} · remaining {formatCount(editing.remainingGenerations)}
          </p>
        ) : (
          <p className="text-xs text-slate-400">Choose Manage on an approved account.</p>
        )}
        <ClassificationField label="Classification" value={props.editClassification} onChange={props.onEditClassification} />
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Authorized generations
          <input
            aria-label="Authorized generations"
            inputMode="numeric"
            value={props.editAllowance}
            onChange={(event) => props.onEditAllowance?.(event.target.value)}
            className={fieldClass}
          />
        </label>
        <AccessField checked={props.editEnabled} onChange={props.onEditEnabled} />
        <ReasonField label="Change reason" value={props.editReason} onChange={props.onEditReason} />
        <ConfirmField checked={props.editConfirmed} onChange={props.onEditConfirmed} />
        <button type="submit" disabled={props.managementSaving || !props.editConfirmed || !editing} className={buttonClass}>
          Save tester changes
        </button>
      </form>
      {props.managementMessage ? (
        <p className="text-sm text-slate-200 xl:col-span-2" aria-live="polite">{props.managementMessage}</p>
      ) : null}
    </div>
  );
}

function ClassificationField(props: {
  label: string;
  value: "individual_beta" | "furniture_partner";
  onChange?: (value: "individual_beta" | "furniture_partner") => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {props.label}
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange?.(event.target.value === "furniture_partner" ? "furniture_partner" : "individual_beta")}
        className={fieldClass}
      >
        <option value="individual_beta">Individual Beta</option>
        <option value="furniture_partner">Furniture Partner</option>
      </select>
    </label>
  );
}

function AccessField(props: { checked: boolean; onChange?: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <input
        aria-label="Allow new generations"
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange?.(event.target.checked)}
      />
      Allow new generations
    </label>
  );
}

function ReasonField(props: { label: string; value: string; onChange?: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {props.label}
      <input aria-label={props.label} value={props.value} onChange={(event) => props.onChange?.(event.target.value)} className={fieldClass} />
    </label>
  );
}

function ConfirmField(props: { checked: boolean; onChange?: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <input
        aria-label="I confirm this tester change."
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange?.(event.target.checked)}
      />
      I confirm this tester change.
    </label>
  );
}

function TesterRow({
  tester,
  onOpen,
  onManage,
}: {
  tester: BetaTesterRecord;
  onOpen?: (userId: string) => void;
  onManage?: (userId: string) => void;
}) {
  return (
    <tr className="border-t border-slate-800">
      <td className="px-2 py-2 align-top">
        <div className="text-sm text-slate-100">{tester.email ?? "Email unavailable"}</div>
        <div className="mt-1 font-mono text-[11px] text-slate-500">{tester.userId}</div>
      </td>
      <td className="px-2 py-2 align-top text-slate-200">{classificationLabel(tester.classification)}</td>
      <td className={`px-2 py-2 align-top font-medium ${tester.enabled ? "text-emerald-300" : "text-rose-300"}`}>
        {tester.enabled ? "Enabled" : "Disabled"}
      </td>
      <td className="px-2 py-2 align-top">{formatCount(tester.authorizedGenerations)}</td>
      <td className="px-2 py-2 align-top">{formatCount(tester.reservedGenerations)}</td>
      <td className="px-2 py-2 align-top">{formatCount(tester.consumedGenerations)}</td>
      <td className="px-2 py-2 align-top">{formatCount(tester.remainingGenerations)}</td>
      <td className="px-2 py-2 align-top">
        <time dateTime={tester.updatedAt}>{formatTimestamp(tester.updatedAt)}</time>
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => onOpen?.(tester.userId)} className={buttonClass}>
            View history
          </button>
          <button type="button" onClick={() => onManage?.(tester.userId)} className={buttonClass}>
            Manage
          </button>
        </div>
      </td>
    </tr>
  );
}

function HistoricalJobs(props: { overview: DashboardOverview; onOpenTester?: (userId: string) => void }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-slate-100">Jobs without a tester allowance</h3>
      <p className="text-xs text-slate-400">
        {formatCount(props.overview.historicalJobsWithoutAllowance)} historical jobs keep a null allowance state.
        They are visible here and are omitted from approved tester totals.
      </p>
      {props.overview.historicalJobs.length === 0 ? (
        <p className="text-sm text-slate-300">No historical jobs without a tester allowance.</p>
      ) : (
        <ul className="space-y-2">
          {props.overview.historicalJobs.map((job) => (
            <li key={job.jobId} className="flex flex-col gap-2 rounded-xl border border-slate-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[11px] text-slate-300">{job.jobId}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {job.userId} · {job.status} · {allowanceLabel(job.allowanceState)} · {formatTimestamp(job.createdAt)}
                </p>
              </div>
              <button type="button" onClick={() => props.onOpenTester?.(job.userId)} className={buttonClass}>
                View history
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeletedAudits(props: { overview: DashboardOverview; onOpenTester?: (userId: string) => void }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-slate-100">Deleted-account audit events</h3>
      <p className="text-xs text-slate-400">
        {formatCount(props.overview.deletedAccountAuditEvents)} retained audit events belong to accounts that have been removed.
      </p>
      {props.overview.deletedAccountAudits.length === 0 ? (
        <p className="text-sm text-slate-300">No retained audit events for removed accounts.</p>
      ) : (
        <ul className="space-y-2">
          {props.overview.deletedAccountAudits.map((audit) => (
            <li key={audit.userId} className="flex flex-col gap-2 rounded-xl border border-slate-800 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[11px] text-slate-300">{audit.userId}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatCount(audit.allowanceEvents)} allowance · {formatCount(audit.resubmitEvents)} recovery · {formatCount(audit.creditResolutions)} credit resolutions
                </p>
              </div>
              <button type="button" onClick={() => props.onOpenTester?.(audit.userId)} className={buttonClass}>
                View retained audit
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistorySection(props: {
  jobs: TesterJobPage | null;
  jobsPhase: "idle" | FurnitureDashboardPhase;
  jobsMessage: string | null;
  detail: JobDetailRecord | null;
  detailPhase: "idle" | FurnitureDashboardPhase;
  detailMessage: string | null;
  onJobPage?: (offset: number) => void;
  onOpenJob?: (jobId: string) => void;
}) {
  if (props.jobsPhase === "idle") return null;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4" aria-label="Generation history">
      <h2 className="text-base font-medium text-slate-100">Generation history</h2>
      {props.jobsPhase === "loading" ? <p className="text-sm text-slate-300">Loading generation history.</p> : null}
      {props.jobsPhase === "error" ? (
        <p className="text-sm text-rose-200">{props.jobsMessage ?? "The furniture generation dashboard could not be loaded."}</p>
      ) : null}
      {props.jobsPhase === "ready" && props.jobs ? (
        <>
          <p className="text-sm text-slate-300">
            {props.jobs.email ?? props.jobs.userId}
            {props.jobs.approved ? " · Approved beta account" : " · No beta allowance on this account."}
          </p>
          {props.jobs.jobs.length === 0 ? (
            <p className="text-sm text-slate-300">No generation jobs for this account.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-slate-400">
                  <tr>
                    <th className="px-2 py-2 font-medium">Job</th>
                    <th className="px-2 py-2 font-medium">Created</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Profile</th>
                    <th className="px-2 py-2 font-medium">Allowance</th>
                    <th className="px-2 py-2 font-medium">Credits</th>
                    <th className="px-2 py-2 font-medium">Credit review</th>
                    <th className="px-2 py-2 font-medium">Error</th>
                    <th className="px-2 py-2 font-medium">Saved asset</th>
                    <th className="px-2 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {props.jobs.jobs.map((job) => (
                    <JobRow key={job.jobId} job={job} onOpen={props.onOpenJob} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PageControls
            offset={props.jobs.offset}
            limit={props.jobs.limit}
            total={props.jobs.total}
            count={props.jobs.jobs.length}
            onPage={props.onJobPage}
          />
          <EventList title="Allowance events" events={props.jobs.allowanceEvents} />
          <ResubmitList events={props.jobs.resubmitEvents} />
          <ResolutionList resolutions={props.jobs.creditResolutions} />
        </>
      ) : null}
      <JobDetailPanel phase={props.detailPhase} message={props.detailMessage} detail={props.detail} />
    </section>
  );
}

function JobRow({ job, onOpen }: { job: GenerationJobRecord; onOpen?: (jobId: string) => void }) {
  return (
    <tr className="border-t border-slate-800">
      <td className="px-2 py-2 align-top font-mono text-[11px] text-slate-300">{job.jobId}</td>
      <td className="px-2 py-2 align-top"><time dateTime={job.createdAt}>{formatTimestamp(job.createdAt)}</time></td>
      <td className="px-2 py-2 align-top">
        <div>{job.status}</div>
        {job.unresolved ? <div className="mt-1 font-medium text-amber-200">Unresolved</div> : null}
      </td>
      <td className="px-2 py-2 align-top text-slate-300">{profileLabel(job)}</td>
      <td className="px-2 py-2 align-top">{allowanceLabel(job.allowanceState)}</td>
      <td className="px-2 py-2 align-top">
        {formatCount(job.reservedCredits)} reserved · {job.consumedCredits == null ? "—" : formatCount(job.consumedCredits)} consumed
      </td>
      <td className="px-2 py-2 align-top">{creditReviewLabel(job.providerCreditReview)}</td>
      <td className="px-2 py-2 align-top">{job.errorClass ?? "—"}</td>
      <td className="px-2 py-2 align-top">{savedAssetLabel(job.savedAssetStatus)}</td>
      <td className="px-2 py-2 align-top">
        <button type="button" onClick={() => onOpen?.(job.jobId)} className={buttonClass}>Details</button>
      </td>
    </tr>
  );
}

function JobDetailPanel(props: {
  phase: "idle" | FurnitureDashboardPhase;
  message: string | null;
  detail: JobDetailRecord | null;
}) {
  if (props.phase === "idle") return null;
  return (
    <div className="rounded-xl border border-slate-800 p-3">
      <h3 className="text-sm font-medium text-slate-100">Job detail</h3>
      {props.phase === "loading" ? <p className="mt-2 text-sm text-slate-300">Loading job detail.</p> : null}
      {props.phase === "error" ? (
        <p className="mt-2 text-sm text-rose-200">{props.message ?? "That generation could not be found."}</p>
      ) : null}
      {props.phase === "ready" && props.detail ? (
        <div className="mt-3 space-y-3">
          {props.detail.job ? (
            <p className="text-sm text-slate-300">
              {props.detail.job.jobId} · {props.detail.job.status} · {allowanceLabel(props.detail.job.allowanceState)}
              {props.detail.job.unresolved ? " · Unresolved" : ""}
            </p>
          ) : (
            <p className="text-sm text-slate-300">This generation job has been removed. Retained audit events remain available.</p>
          )}
          <EventList title="Allowance events for this job" events={props.detail.allowanceEvents} />
          <ResubmitList events={props.detail.resubmitEvents} />
          {props.detail.creditResolution ? (
            <ResolutionList resolutions={[props.detail.creditResolution]} />
          ) : (
            <p className="text-xs text-slate-500">No operator credit resolution is recorded for this job.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EventList({ title, events }: { title: string; events: AllowanceEventRecord[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-100">{title}</h3>
      {events.length === 0 ? <p className="mt-1 text-xs text-slate-500">No allowance events in this result.</p> : (
        <ul className="mt-2 space-y-1 text-xs text-slate-300">
          {events.map((event) => (
            <li key={event.eventId}>
              {event.action} · {event.actorKind} · {event.reason ?? "Reason withheld"}
              {eventContext(event) ? ` · ${eventContext(event)}` : ""} · {formatTimestamp(event.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResubmitList({ events }: { events: ResubmitEventRecord[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-100">Recovery events</h3>
      {events.length === 0 ? <p className="mt-1 text-xs text-slate-500">No recovery events in this result.</p> : (
        <ul className="mt-2 space-y-1 text-xs text-slate-300">
          {events.map((event) => (
            <li key={event.eventId}>{event.action} · {event.reason} · {formatTimestamp(event.createdAt)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResolutionList({ resolutions }: { resolutions: CreditResolutionRecord[] }) {
  if (resolutions.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-100">Credit resolutions</h3>
      <ul className="mt-2 space-y-1 text-xs text-slate-300">
        {resolutions.map((resolution) => (
          <li key={`${resolution.jobId}-${resolution.createdAt}`}>
            {resolution.providerStatus} · {formatCount(resolution.consumedCredits)} provider credits · {resolution.reason ?? "Reason withheld"}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PageControls(props: {
  offset: number;
  limit: number;
  total: number;
  count: number;
  onPage?: (offset: number) => void;
}) {
  if (props.total <= props.limit) return null;
  const start = props.offset + 1;
  const end = props.offset + props.count;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-400">Showing {start}–{end} of {formatCount(props.total)}</p>
      <div className="flex gap-2">
        <button type="button" disabled={props.offset === 0} onClick={() => props.onPage?.(Math.max(0, props.offset - props.limit))} className={buttonClass}>
          Previous
        </button>
        <button type="button" disabled={props.offset + props.limit >= props.total} onClick={() => props.onPage?.(props.offset + props.limit)} className={buttonClass}>
          Next
        </button>
      </div>
    </div>
  );
}

function eventContext(event: AllowanceEventRecord): string | null {
  const parts: string[] = [];
  if (event.classificationBefore !== event.classificationAfter && (event.classificationBefore || event.classificationAfter)) {
    parts.push(event.classificationBefore
      ? `Classification ${classificationLabel(event.classificationBefore)} to ${event.classificationAfter ? classificationLabel(event.classificationAfter) : "unset"}`
      : `Classification set to ${event.classificationAfter ? classificationLabel(event.classificationAfter) : "unset"}`);
  }
  if (event.enabledBefore !== event.enabledAfter && (event.enabledBefore != null || event.enabledAfter != null)) {
    const from = event.enabledBefore == null ? "unset" : event.enabledBefore ? "enabled" : "disabled";
    const to = event.enabledAfter == null ? "unset" : event.enabledAfter ? "enabled" : "disabled";
    parts.push(event.enabledBefore == null ? `Access set to ${to}` : `Access ${from} to ${to}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function classificationLabel(value: BetaTesterRecord["classification"]): string {
  return value === "individual_beta" ? "Individual Beta" : "Furniture Partner";
}

function allowanceLabel(value: GenerationJobRecord["allowanceState"]): string {
  if (value === "reserved") return "Reserved";
  if (value === "consumed") return "Consumed";
  if (value === "released") return "Released";
  return "No tester allowance";
}

function creditReviewLabel(value: GenerationJobRecord["providerCreditReview"]): string {
  if (value === "reported") return "Reported";
  if (value === "unreported") return "Unreported";
  if (value === "operator_resolved") return "Operator resolved";
  if (value === "pending") return "Pending";
  return "Not contacted";
}

function savedAssetLabel(value: GenerationJobRecord["savedAssetStatus"]): string {
  if (value === "permanently_saved") return "Permanently saved";
  if (value === "candidate_ready") return "Candidate ready";
  return "Not saved";
}

function profileLabel(job: GenerationJobRecord): string {
  const texture = job.profile.shouldTexture == null ? null : job.profile.shouldTexture ? "textured" : "untextured";
  return [job.operation, job.profile.geometryResolution, job.profile.textureResolution, texture]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}

const fieldClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400";
const buttonClass = "rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-40";
