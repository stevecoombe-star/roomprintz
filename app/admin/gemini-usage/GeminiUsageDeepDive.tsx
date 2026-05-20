"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type GeminiUsageWindowPreset = "this-month" | "last-month" | "custom-range";
type GeminiStatusMode = "success" | "failure";

type DailyBreakdownResponse = {
  from?: unknown;
  to?: unknown;
  statusMode?: unknown;
  timeZone?: unknown;
  models?: unknown;
  rows?: unknown;
  summary?: {
    totalCalls?: unknown;
    successCount?: unknown;
    failureCount?: unknown;
    selectedStatusCount?: unknown;
    topModel?: {
      model?: unknown;
      calls?: unknown;
    } | null;
  };
  error?: unknown;
};

type DailyBreakdownRow = {
  date: string;
  modelCounts: Record<string, number>;
  total: number;
};

type DailyBreakdownData = {
  from: string;
  to: string;
  statusMode: GeminiStatusMode;
  models: string[];
  rows: DailyBreakdownRow[];
  summary: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    selectedStatusCount: number;
    topModel: { model: string; calls: number } | null;
  };
};

type UserModelBreakdownResponse = {
  from?: unknown;
  to?: unknown;
  statusMode?: unknown;
  models?: unknown;
  rows?: unknown;
  summary?: {
    totalUsers?: unknown;
    selectedStatusCount?: unknown;
  };
  error?: unknown;
};

type UserModelBreakdownRow = {
  userId: string | null;
  userEmail: string | null;
  modelCounts: Record<string, number>;
  total: number;
};

type UserModelBreakdownData = {
  from: string;
  to: string;
  statusMode: GeminiStatusMode;
  models: string[];
  rows: UserModelBreakdownRow[];
  summary: {
    totalUsers: number;
    selectedStatusCount: number;
  };
};

const KNOWN_MODEL_COLORS: Record<string, string> = {
  "gemini-3-pro-image-preview": "#4f46e5",
  "gemini-3.1-flash-image-preview": "#0ea5e9",
  "gemini-3-flash-preview": "#22c55e",
};

const FALLBACK_MODEL_COLORS = [
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#14b8a6",
  "#84cc16",
  "#64748b",
];

const DAILY_USAGE_TIME_ZONE = "America/Vancouver";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : 0;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addMonthsUtc(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 0, 0, 0, 0));
}

function formatMetric(value: number): string {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString() : "0";
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Invalid";
  return new Date(timestamp).toLocaleString(undefined, { timeZone: DAILY_USAGE_TIME_ZONE });
}

function formatDateBucket(value: string): string {
  const timestamp = Date.parse(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString(undefined, {
    timeZone: DAILY_USAGE_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
}

function resolveGeminiUsageWindow(args: {
  preset: GeminiUsageWindowPreset;
  customStartDate: string;
  customEndDate: string;
}) {
  const now = new Date();
  if (args.preset === "this-month") {
    return {
      fromIso: startOfMonthUtc(now).toISOString(),
      toIso: now.toISOString(),
      windowKey: "this-month" as const,
    };
  }

  if (args.preset === "last-month") {
    const currentMonthStart = startOfMonthUtc(now);
    const lastMonthStart = addMonthsUtc(currentMonthStart, -1);
    return {
      fromIso: lastMonthStart.toISOString(),
      toIso: currentMonthStart.toISOString(),
      windowKey: "last-month" as const,
    };
  }

  const startRaw = args.customStartDate.trim();
  const endRaw = args.customEndDate.trim();
  if (!startRaw || !endRaw) {
    return { error: "Custom range requires both start and end dates." };
  }
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const endExclusive = new Date(`${endRaw}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(endExclusive.getTime())) {
    return { error: "Invalid custom date range." };
  }
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (start.getTime() >= endExclusive.getTime()) {
    return { error: "Custom start date must be on or before end date." };
  }
  return {
    fromIso: start.toISOString(),
    toIso: endExclusive.toISOString(),
    windowKey: "custom-range" as const,
  };
}

function resolveModelColors(models: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let fallbackIndex = 0;
  for (const model of models) {
    const knownColor = KNOWN_MODEL_COLORS[model];
    if (knownColor) {
      map.set(model, knownColor);
      continue;
    }
    map.set(model, FALLBACK_MODEL_COLORS[fallbackIndex % FALLBACK_MODEL_COLORS.length]);
    fallbackIndex += 1;
  }
  return map;
}

function normalizeDailyBreakdownResponse(payload: DailyBreakdownResponse): DailyBreakdownData | null {
  const from = normalizeString(payload.from);
  const to = normalizeString(payload.to);
  const statusMode = payload.statusMode === "failure" ? "failure" : "success";

  if (!from || !to) return null;

  const models = Array.isArray(payload.models)
    ? payload.models.map((model) => normalizeString(model)).filter((model) => model.length > 0)
    : [];
  const rows = Array.isArray(payload.rows)
    ? payload.rows
        .map((entry): DailyBreakdownRow | null => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as { date?: unknown; modelCounts?: unknown; total?: unknown };
          const date = normalizeString(item.date);
          if (!date) return null;

          const modelCounts: Record<string, number> = {};
          const rawModelCounts =
            item.modelCounts && typeof item.modelCounts === "object"
              ? (item.modelCounts as Record<string, unknown>)
              : {};
          for (const model of models) {
            modelCounts[model] = normalizeNonNegativeInt(rawModelCounts[model]);
          }

          const total = normalizeNonNegativeInt(item.total);
          return { date, modelCounts, total };
        })
        .filter((row): row is DailyBreakdownRow => Boolean(row))
    : [];

  return {
    from,
    to,
    statusMode,
    models,
    rows,
    summary: {
      totalCalls: normalizeNonNegativeInt(payload.summary?.totalCalls),
      successCount: normalizeNonNegativeInt(payload.summary?.successCount),
      failureCount: normalizeNonNegativeInt(payload.summary?.failureCount),
      selectedStatusCount: normalizeNonNegativeInt(payload.summary?.selectedStatusCount),
      topModel:
        payload.summary?.topModel &&
        typeof payload.summary.topModel === "object" &&
        normalizeString(payload.summary.topModel.model)
          ? {
              model: normalizeString(payload.summary.topModel.model),
              calls: normalizeNonNegativeInt(payload.summary.topModel.calls),
            }
          : null,
    },
  };
}

function normalizeUserModelBreakdownResponse(
  payload: UserModelBreakdownResponse
): UserModelBreakdownData | null {
  const from = normalizeString(payload.from);
  const to = normalizeString(payload.to);
  const statusMode = payload.statusMode === "failure" ? "failure" : "success";
  if (!from || !to) return null;

  const models = Array.isArray(payload.models)
    ? payload.models.map((model) => normalizeString(model)).filter((model) => model.length > 0)
    : [];

  const rows = Array.isArray(payload.rows)
    ? payload.rows
        .map((entry): UserModelBreakdownRow | null => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as {
            userId?: unknown;
            userEmail?: unknown;
            modelCounts?: unknown;
            total?: unknown;
          };
          const userId = normalizeString(item.userId) || null;
          const userEmail = normalizeString(item.userEmail) || null;
          const rawModelCounts =
            item.modelCounts && typeof item.modelCounts === "object"
              ? (item.modelCounts as Record<string, unknown>)
              : {};

          const modelCounts: Record<string, number> = {};
          for (const model of models) {
            modelCounts[model] = normalizeNonNegativeInt(rawModelCounts[model]);
          }
          return {
            userId,
            userEmail,
            modelCounts,
            total: normalizeNonNegativeInt(item.total),
          };
        })
        .filter((row): row is UserModelBreakdownRow => Boolean(row))
    : [];

  return {
    from,
    to,
    statusMode,
    models,
    rows,
    summary: {
      totalUsers: normalizeNonNegativeInt(payload.summary?.totalUsers),
      selectedStatusCount: normalizeNonNegativeInt(payload.summary?.selectedStatusCount),
    },
  };
}

function StackedDailyChart(props: {
  rows: DailyBreakdownRow[];
  models: string[];
  modelColors: Map<string, string>;
}) {
  const { rows, models, modelColors } = props;
  const maxTotal = Math.max(1, ...rows.map((row) => row.total));
  const chartHeight = 248;
  const plotHeight = 178;
  const plotTop = 16;
  const plotBottom = plotTop + plotHeight;
  const leftPad = 44;
  const rightPad = 14;
  const barWidth = 18;
  const barGap = 8;
  const rowSpan = barWidth + barGap;
  const chartWidth = leftPad + rightPad + Math.max(rows.length * rowSpan, 560);
  const yTickCount = 4;
  const xLabelStep = rows.length > 45 ? 5 : rows.length > 25 ? 3 : rows.length > 14 ? 2 : 1;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="overflow-x-auto">
        <svg width={chartWidth} height={chartHeight} role="img" aria-label="Gemini usage daily stacked bar chart">
          {Array.from({ length: yTickCount + 1 }).map((_, index) => {
            const ratio = index / yTickCount;
            const y = plotTop + ratio * plotHeight;
            const tickValue = Math.round((1 - ratio) * maxTotal);
            return (
              <g key={`y-grid-${index}`}>
                <line x1={leftPad} y1={y} x2={chartWidth - rightPad} y2={y} stroke="#334155" strokeWidth={1} />
                <text x={leftPad - 8} y={y + 4} fill="#94a3b8" textAnchor="end" fontSize={10}>
                  {tickValue}
                </text>
              </g>
            );
          })}

          {rows.map((row, index) => {
            const x = leftPad + index * rowSpan + barGap / 2;
            let currentTop = plotBottom;

            return (
              <g key={row.date}>
                {models.map((model) => {
                  const count = row.modelCounts[model] ?? 0;
                  if (count <= 0) return null;
                  const segmentHeight = (count / maxTotal) * plotHeight;
                  const y = currentTop - segmentHeight;
                  currentTop = y;
                  return (
                    <rect
                      key={`${row.date}:${model}`}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={segmentHeight}
                      fill={modelColors.get(model) ?? "#64748b"}
                      rx={2}
                    >
                      <title>{`${row.date} | ${model}: ${count}`}</title>
                    </rect>
                  );
                })}

                {index % xLabelStep === 0 && (
                  <text x={x + barWidth / 2} y={plotBottom + 14} fill="#94a3b8" textAnchor="middle" fontSize={10}>
                    {row.date.slice(-2)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        X-axis uses day-of-month labels in Pacific Time ({DAILY_USAGE_TIME_ZONE}).
      </p>
    </div>
  );
}

export default function GeminiUsageDeepDive() {
  const [windowPreset, setWindowPreset] = useState<GeminiUsageWindowPreset>("this-month");
  const [customStartDate, setCustomStartDate] = useState<string>(() =>
    toDateInputValue(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
  );
  const [customEndDate, setCustomEndDate] = useState<string>(() => toDateInputValue(new Date()));
  const [statusMode, setStatusMode] = useState<GeminiStatusMode>("success");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DailyBreakdownData | null>(null);
  const [isUserUsageLoading, setIsUserUsageLoading] = useState(false);
  const [isUserUsageExporting, setIsUserUsageExporting] = useState(false);
  const [userUsageError, setUserUsageError] = useState<string | null>(null);
  const [userUsageData, setUserUsageData] = useState<UserModelBreakdownData | null>(null);
  const [showAllUserUsage, setShowAllUserUsage] = useState(false);

  const modelColors = useMemo(() => resolveModelColors(data?.models ?? []), [data?.models]);
  const selectedRowsTotal = useMemo(
    () => (data ? data.rows.reduce((sum, row) => sum + row.total, 0) : 0),
    [data]
  );
  const hasMismatch = data !== null && selectedRowsTotal !== data.summary.selectedStatusCount;
  const visibleUserUsageRows = useMemo(
    () =>
      userUsageData
        ? showAllUserUsage
          ? userUsageData.rows
          : userUsageData.rows.slice(0, 25)
        : [],
    [showAllUserUsage, userUsageData]
  );

  const loadDailyBreakdown = useCallback(async () => {
    const range = resolveGeminiUsageWindow({
      preset: windowPreset,
      customStartDate,
      customEndDate,
    });
    if ("error" in range) {
      setError(range.error ?? "Invalid date range.");
      setData(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const query = `?from=${encodeURIComponent(range.fromIso)}&to=${encodeURIComponent(range.toIso)}&status=${encodeURIComponent(statusMode)}`;
      const response = await fetch(`/api/admin/gemini-usage/daily${query}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as DailyBreakdownResponse;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to load Gemini usage daily breakdown."
        );
      }
      const normalized = normalizeDailyBreakdownResponse(payload);
      if (!normalized) {
        throw new Error("Gemini usage daily response is missing required fields.");
      }
      setData(normalized);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Gemini usage daily breakdown.");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [customEndDate, customStartDate, statusMode, windowPreset]);

  useEffect(() => {
    void loadDailyBreakdown();
  }, [loadDailyBreakdown]);

  const loadUserModelBreakdown = useCallback(async () => {
    const range = resolveGeminiUsageWindow({
      preset: windowPreset,
      customStartDate,
      customEndDate,
    });
    if ("error" in range) {
      setUserUsageError(range.error ?? "Invalid date range.");
      setUserUsageData(null);
      return;
    }

    setIsUserUsageLoading(true);
    setUserUsageError(null);
    try {
      const query = `?from=${encodeURIComponent(range.fromIso)}&to=${encodeURIComponent(range.toIso)}&status=${encodeURIComponent(statusMode)}`;
      const response = await fetch(`/api/admin/gemini-usage/by-user-model${query}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as UserModelBreakdownResponse;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to load user usage by model."
        );
      }
      const normalized = normalizeUserModelBreakdownResponse(payload);
      if (!normalized) {
        throw new Error("User usage by model response is missing required fields.");
      }
      setUserUsageData(normalized);
      setShowAllUserUsage(false);
    } catch (err: unknown) {
      setUserUsageError(err instanceof Error ? err.message : "Failed to load user usage by model.");
      setUserUsageData(null);
    } finally {
      setIsUserUsageLoading(false);
    }
  }, [customEndDate, customStartDate, statusMode, windowPreset]);

  useEffect(() => {
    void loadUserModelBreakdown();
  }, [loadUserModelBreakdown]);

  const exportDailyCsv = useCallback(async () => {
    const range = resolveGeminiUsageWindow({
      preset: windowPreset,
      customStartDate,
      customEndDate,
    });
    if ("error" in range) {
      setError(range.error ?? "Invalid date range.");
      return;
    }

    setIsExporting(true);
    setError(null);
    try {
      const query = `?from=${encodeURIComponent(range.fromIso)}&to=${encodeURIComponent(range.toIso)}&status=${encodeURIComponent(statusMode)}`;
      const response = await fetch(`/api/admin/gemini-usage/daily/export${query}`, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to export CSV.");
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `vibode-gemini-usage-daily-${statusMode}.csv`;
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export CSV.");
    } finally {
      setIsExporting(false);
    }
  }, [customEndDate, customStartDate, statusMode, windowPreset]);

  const exportUserUsageCsv = useCallback(async () => {
    const range = resolveGeminiUsageWindow({
      preset: windowPreset,
      customStartDate,
      customEndDate,
    });
    if ("error" in range) {
      setUserUsageError(range.error ?? "Invalid date range.");
      return;
    }

    setIsUserUsageExporting(true);
    setUserUsageError(null);
    try {
      const query = `?from=${encodeURIComponent(range.fromIso)}&to=${encodeURIComponent(range.toIso)}&status=${encodeURIComponent(statusMode)}`;
      const response = await fetch(`/api/admin/gemini-usage/by-user-model/export${query}`, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to export user usage CSV.");
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `vibode-gemini-usage-by-user-model-${statusMode}.csv`;
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setUserUsageError(err instanceof Error ? err.message : "Failed to export user usage CSV.");
    } finally {
      setIsUserUsageExporting(false);
    }
  }, [customEndDate, customStartDate, statusMode, windowPreset]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Gemini Usage Analytics</h1>
              <p className="mt-1 text-sm text-slate-400">
                Daily analytics for Vibode Gemini model calls.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/gemini-usage/ledger"
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Open ledger
              </Link>
              <Link
                href="/admin"
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Back to Admin
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">Window</span>
                <select
                  value={windowPreset}
                  onChange={(event) => setWindowPreset(event.target.value as GeminiUsageWindowPreset)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="this-month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="custom-range">Custom range</option>
                </select>
              </label>

              {windowPreset === "custom-range" && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Start date</span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(event) => setCustomStartDate(event.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">End date</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(event) => setCustomEndDate(event.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStatusMode("success")}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  statusMode === "success"
                    ? "border-emerald-400/80 bg-emerald-500/15 text-emerald-200"
                    : "border-slate-700 text-slate-200 hover:border-emerald-400/60 hover:text-emerald-200"
                }`}
              >
                Success calls
              </button>
              <button
                type="button"
                onClick={() => setStatusMode("failure")}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  statusMode === "failure"
                    ? "border-rose-400/80 bg-rose-500/15 text-rose-200"
                    : "border-slate-700 text-slate-200 hover:border-rose-400/60 hover:text-rose-200"
                }`}
              >
                Failure calls
              </button>
              <button
                type="button"
                onClick={() => void exportDailyCsv()}
                disabled={isExporting}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
              >
                {isExporting ? "Exporting..." : "Export CSV"}
              </button>
              <button
                type="button"
                onClick={() => void loadDailyBreakdown()}
                disabled={isLoading}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
              >
                {isLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}

          {data && (
            <div className="mt-4 grid gap-2 text-xs md:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-slate-400">Total successful calls</p>
                <p className="mt-1 text-sm font-medium text-emerald-300">{formatMetric(data.summary.successCount)}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-slate-400">Total failed calls</p>
                <p className="mt-1 text-sm font-medium text-rose-300">{formatMetric(data.summary.failureCount)}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-slate-400">Total calls</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{formatMetric(data.summary.totalCalls)}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-slate-400">Top model by calls</p>
                <p className="mt-1 text-sm font-medium text-slate-100">
                  {data.summary.topModel
                    ? `${data.summary.topModel.model} (${formatMetric(data.summary.topModel.calls)})`
                    : "No model data"}
                </p>
              </div>
            </div>
          )}

          {data && (
            <p className="mt-2 text-[11px] text-slate-500">
              Range: {formatTimestamp(data.from)} to {formatTimestamp(data.to)} | Active mode total:{" "}
              {formatMetric(data.summary.selectedStatusCount)}
            </p>
          )}
          {hasMismatch && (
            <p className="mt-1 text-[11px] text-amber-300">
              Reconciliation warning: active summary total ({formatMetric(data?.summary.selectedStatusCount ?? 0)})
              does not match summed daily rows ({formatMetric(selectedRowsTotal)}).
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-medium text-slate-100">Daily Stacked Calls by Model</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                statusMode === "success" ? "bg-emerald-500/15 text-emerald-200" : "bg-rose-500/15 text-rose-200"
              }`}
            >
              {statusMode === "success" ? "Success mode" : "Failure mode"}
            </span>
          </div>

          {!data && !isLoading && <p className="text-xs text-slate-500">No data loaded.</p>}

          {data && data.models.length === 0 && (
            <p className="text-xs text-slate-500">No model calls found for the selected filters.</p>
          )}

          {data && data.models.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap gap-3">
                {data.models.map((model) => (
                  <div key={model} className="flex items-center gap-2 text-xs text-slate-300">
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: modelColors.get(model) ?? "#64748b" }}
                      aria-hidden="true"
                    />
                    <span>{model}</span>
                  </div>
                ))}
              </div>
              <StackedDailyChart rows={data.rows} models={data.models} modelColors={modelColors} />
            </>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-base font-medium text-slate-100">Daily Breakdown Table</h2>
          <p className="mt-1 text-xs text-slate-400">
            Table mirrors the selected status mode ({statusMode === "success" ? "success" : "failure"}).
          </p>

          {data && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-slate-950/70 text-slate-300">
                  <tr>
                    <th className="border-b border-slate-800 px-3 py-2 text-left font-medium">Date</th>
                    {data.models.map((model) => (
                      <th key={model} className="border-b border-slate-800 px-3 py-2 text-right font-medium">
                        {model}
                      </th>
                    ))}
                    <th className="border-b border-slate-800 px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.date} className="odd:bg-slate-950/30">
                      <td className="border-b border-slate-800/80 px-3 py-2 text-slate-200">
                        {formatDateBucket(row.date)}
                      </td>
                      {data.models.map((model) => (
                        <td key={`${row.date}:${model}`} className="border-b border-slate-800/80 px-3 py-2 text-right text-slate-300">
                          {formatMetric(row.modelCounts[model] ?? 0)}
                        </td>
                      ))}
                      <td className="border-b border-slate-800/80 px-3 py-2 text-right font-medium text-slate-100">
                        {formatMetric(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-slate-100">User Usage by Model</h2>
              <p className="mt-1 text-xs text-slate-400">
                Top users driving Gemini calls for the selected range and status mode.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {userUsageData && userUsageData.rows.length > 25 && (
                <button
                  type="button"
                  onClick={() => setShowAllUserUsage((prev) => !prev)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
                >
                  {showAllUserUsage ? "Show top 25" : "Show all"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void exportUserUsageCsv()}
                disabled={isUserUsageExporting}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
              >
                {isUserUsageExporting ? "Exporting..." : "Export user usage CSV"}
              </button>
            </div>
          </div>

          {userUsageError && <p className="mt-3 text-xs text-rose-300">{userUsageError}</p>}
          {isUserUsageLoading && <p className="mt-3 text-xs text-slate-400">Loading user usage...</p>}

          {userUsageData && (
            <>
              <p className="mt-2 text-[11px] text-slate-500">
                Users: {formatMetric(userUsageData.summary.totalUsers)} | Active mode total:{" "}
                {formatMetric(userUsageData.summary.selectedStatusCount)}
              </p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-slate-950/70 text-slate-300">
                    <tr>
                      <th className="border-b border-slate-800 px-3 py-2 text-left font-medium">User</th>
                      {userUsageData.models.map((model) => (
                        <th key={model} className="border-b border-slate-800 px-3 py-2 text-right font-medium">
                          {model}
                        </th>
                      ))}
                      <th className="border-b border-slate-800 px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUserUsageRows.map((row) => (
                      <tr key={`${row.userId ?? "no-user"}:${row.userEmail ?? "no-email"}`} className="odd:bg-slate-950/30">
                        <td className="border-b border-slate-800/80 px-3 py-2 text-slate-200">
                          <p>{row.userEmail ?? "Unknown user"}</p>
                          {row.userId && <p className="text-[11px] text-slate-500">{row.userId}</p>}
                        </td>
                        {userUsageData.models.map((model) => (
                          <td
                            key={`${row.userId ?? row.userEmail ?? "unknown"}:${model}`}
                            className="border-b border-slate-800/80 px-3 py-2 text-right text-slate-300"
                          >
                            {formatMetric(row.modelCounts[model] ?? 0)}
                          </td>
                        ))}
                        <td className="border-b border-slate-800/80 px-3 py-2 text-right font-medium text-slate-100">
                          {formatMetric(row.total)}
                        </td>
                      </tr>
                    ))}
                    {visibleUserUsageRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={Math.max(2, userUsageData.models.length + 2)}
                          className="px-3 py-4 text-center text-slate-500"
                        >
                          No user model usage in selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
