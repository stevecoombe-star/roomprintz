"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

type LedgerWindowPreset = "this-month" | "last-month" | "all-time" | "custom-range";
type LedgerPageSize = 25 | 50 | 100;

type LedgerRow = {
  created_at: string | null;
  user_email: string | null;
  model: string | null;
  workflow_type: string | null;
  action_type: string | null;
  source_trigger: string | null;
  status: "success" | "failure" | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  route: string | null;
  service: string | null;
  user_id: string | null;
  room_id: string | null;
  version_id: string | null;
  asset_id: string | null;
  request_id: string | null;
  attempt_id: string | null;
};

type LedgerResponse = {
  rows?: unknown;
  totalCount?: unknown;
  limit?: unknown;
  offset?: unknown;
  hasNext?: unknown;
  hasPrevious?: unknown;
  error?: unknown;
};

const PACIFIC_TIME_ZONE = "America/Vancouver";
const COLUMN_WIDTHS_STORAGE_KEY = "vibode:gemini-ledger-column-widths:v1";
const MIN_COLUMN_WIDTH = 80;
const AUTO_FIT_PADDING = 34;
const MAX_AUTO_FIT_WIDTH = 560;
const RESIZE_HANDLE_HIT_WIDTH_CLASS = "w-3";
const RESIZE_DEBUG_STORAGE_KEY = "vibode:gemini-ledger-resize-debug";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getZonedParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number.parseInt(map.year ?? "0", 10),
    month: Number.parseInt(map.month ?? "0", 10),
    day: Number.parseInt(map.day ?? "0", 10),
    hour: Number.parseInt(map.hour ?? "0", 10),
    minute: Number.parseInt(map.minute ?? "0", 10),
    second: Number.parseInt(map.second ?? "0", 10),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtcIso(dateValue: string, timeValue: string): string | null {
  const dateMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeValue.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number.parseInt(dateMatch[1] ?? "", 10);
  const month = Number.parseInt(dateMatch[2] ?? "", 10);
  const day = Number.parseInt(dateMatch[3] ?? "", 10);
  const hour = Number.parseInt(timeMatch[1] ?? "", 10);
  const minute = Number.parseInt(timeMatch[2] ?? "", 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(utcGuessMs);
  const offset = getTimeZoneOffsetMs(candidate, PACIFIC_TIME_ZONE);
  candidate = new Date(utcGuessMs - offset);
  const refinedOffset = getTimeZoneOffsetMs(candidate, PACIFIC_TIME_ZONE);
  if (refinedOffset !== offset) {
    candidate = new Date(utcGuessMs - refinedOffset);
  }
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : null;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const base = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
  };
}

function asDateString(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveWindowRange(args: {
  preset: LedgerWindowPreset;
  customStartDate: string;
  customStartTime: string;
  customEndDate: string;
  customEndTime: string;
}): { fromIso: string; toIso: string } | { error: string } {
  const now = new Date();
  const pacificNow = getZonedParts(now, PACIFIC_TIME_ZONE);

  if (args.preset === "all-time") {
    return {
      fromIso: new Date(0).toISOString(),
      toIso: now.toISOString(),
    };
  }

  if (args.preset === "this-month") {
    const startDate = asDateString(pacificNow.year, pacificNow.month, 1);
    const fromIso = zonedDateTimeToUtcIso(startDate, "00:00");
    if (!fromIso) return { error: "Failed to resolve this-month range." };
    return { fromIso, toIso: now.toISOString() };
  }

  if (args.preset === "last-month") {
    const previousMonth = addMonths(pacificNow.year, pacificNow.month, -1);
    const lastMonthStart = asDateString(previousMonth.year, previousMonth.month, 1);
    const thisMonthStart = asDateString(pacificNow.year, pacificNow.month, 1);
    const fromIso = zonedDateTimeToUtcIso(lastMonthStart, "00:00");
    const toIso = zonedDateTimeToUtcIso(thisMonthStart, "00:00");
    if (!fromIso || !toIso) return { error: "Failed to resolve last-month range." };
    return { fromIso, toIso };
  }

  if (!args.customStartDate.trim() || !args.customEndDate.trim()) {
    return { error: "Custom range requires both start and end dates." };
  }
  const fromIso = zonedDateTimeToUtcIso(args.customStartDate.trim(), args.customStartTime.trim());
  const toIso = zonedDateTimeToUtcIso(args.customEndDate.trim(), args.customEndTime.trim());
  if (!fromIso || !toIso) {
    return { error: "Invalid custom start/end date or time." };
  }
  if (Date.parse(fromIso) > Date.parse(toIso)) {
    return { error: "Custom start must be before custom end." };
  }
  return { fromIso, toIso };
}

function formatPacificTimestamp(value: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString(undefined, { timeZone: PACIFIC_TIME_ZONE });
}

function formatNullable(value: string | null): string {
  return value && value.trim() ? value : "—";
}

function formatNumeric(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Math.trunc(value).toLocaleString();
}

function truncateMiddle(value: string | null, maxLength = 20): string {
  if (!value) return "—";
  if (value.length <= maxLength) return value;
  const segment = Math.max(4, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, segment)}...${value.slice(-segment)}`;
}

function normalizeLedgerResponse(payload: LedgerResponse): {
  rows: LedgerRow[];
  totalCount: number;
  limit: number;
  offset: number;
  hasNext: boolean;
  hasPrevious: boolean;
} {
  const rows = Array.isArray(payload.rows)
    ? payload.rows
        .map((entry): LedgerRow | null => {
          if (!entry || typeof entry !== "object") return null;
          const row = entry as Record<string, unknown>;
          return {
            created_at: normalizeString(row.created_at) || null,
            user_email: normalizeString(row.user_email) || null,
            model: normalizeString(row.model) || null,
            workflow_type: normalizeString(row.workflow_type) || null,
            action_type: normalizeString(row.action_type) || null,
            source_trigger: normalizeString(row.source_trigger) || null,
            status: row.status === "failure" ? "failure" : row.status === "success" ? "success" : null,
            latency_ms: typeof row.latency_ms === "number" ? row.latency_ms : null,
            input_tokens: typeof row.input_tokens === "number" ? row.input_tokens : null,
            output_tokens: typeof row.output_tokens === "number" ? row.output_tokens : null,
            route: normalizeString(row.route) || null,
            service: normalizeString(row.service) || null,
            user_id: normalizeString(row.user_id) || null,
            room_id: normalizeString(row.room_id) || null,
            version_id: normalizeString(row.version_id) || null,
            asset_id: normalizeString(row.asset_id) || null,
            request_id: normalizeString(row.request_id) || null,
            attempt_id: normalizeString(row.attempt_id) || null,
          };
        })
        .filter((row): row is LedgerRow => Boolean(row))
    : [];

  return {
    rows,
    totalCount: Math.max(0, normalizeInt(payload.totalCount, 0)),
    limit: Math.max(1, normalizeInt(payload.limit, 25)),
    offset: Math.max(0, normalizeInt(payload.offset, 0)),
    hasNext: payload.hasNext === true,
    hasPrevious: payload.hasPrevious === true,
  };
}

function statusBadge(status: LedgerRow["status"]): { text: string; className: string } {
  if (status === "success") {
    return { text: "success", className: "border border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (status === "failure") {
    return { text: "failure", className: "border border-rose-200 bg-rose-50 text-rose-800" };
  }
  return { text: "unknown", className: "bg-slate-700/40 text-slate-300" };
}

type LedgerColumnKey =
  | "created_at"
  | "user_email"
  | "model"
  | "workflow_type"
  | "action_type"
  | "source_trigger"
  | "status"
  | "latency_ms"
  | "input_tokens"
  | "output_tokens"
  | "route"
  | "service"
  | "user_id"
  | "room_id"
  | "version_id"
  | "asset_id"
  | "request_id"
  | "attempt_id";

type LedgerColumnConfig = {
  key: LedgerColumnKey;
  label: string;
  defaultWidth: number;
  minWidth?: number;
  headerAlign: "left" | "right";
  cellClassName: string;
  renderCell: (row: LedgerRow) => ReactNode;
  measureText: (row: LedgerRow) => string;
  title?: (row: LedgerRow) => string;
};

const LEDGER_COLUMNS: LedgerColumnConfig[] = [
  {
    key: "created_at",
    label: "Created (PT)",
    defaultWidth: 190,
    headerAlign: "left",
    cellClassName: "text-slate-800",
    renderCell: (row) => formatPacificTimestamp(row.created_at),
    measureText: (row) => formatPacificTimestamp(row.created_at),
  },
  {
    key: "user_email",
    label: "User email",
    defaultWidth: 220,
    headerAlign: "left",
    cellClassName: "text-slate-800",
    renderCell: (row) => row.user_email ?? "Unknown user",
    measureText: (row) => row.user_email ?? "Unknown user",
  },
  {
    key: "model",
    label: "Model",
    defaultWidth: 210,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => formatNullable(row.model),
    measureText: (row) => formatNullable(row.model),
  },
  {
    key: "workflow_type",
    label: "Workflow",
    defaultWidth: 140,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => formatNullable(row.workflow_type),
    measureText: (row) => formatNullable(row.workflow_type),
  },
  {
    key: "action_type",
    label: "Action",
    defaultWidth: 130,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => formatNullable(row.action_type),
    measureText: (row) => formatNullable(row.action_type),
  },
  {
    key: "source_trigger",
    label: "Source trigger",
    defaultWidth: 150,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => formatNullable(row.source_trigger),
    measureText: (row) => formatNullable(row.source_trigger),
  },
  {
    key: "status",
    label: "Status",
    defaultWidth: 105,
    headerAlign: "left",
    cellClassName: "",
    renderCell: (row) => {
      const badge = statusBadge(row.status);
      return <span className={`rounded-full px-2 py-0.5 text-[11px] ${badge.className}`}>{badge.text}</span>;
    },
    measureText: (row) => statusBadge(row.status).text,
  },
  {
    key: "latency_ms",
    label: "Latency (ms)",
    defaultWidth: 112,
    headerAlign: "right",
    cellClassName: "text-right text-slate-700",
    renderCell: (row) => formatNumeric(row.latency_ms),
    measureText: (row) => formatNumeric(row.latency_ms),
  },
  {
    key: "input_tokens",
    label: "Input tokens",
    defaultWidth: 112,
    headerAlign: "right",
    cellClassName: "text-right text-slate-700",
    renderCell: (row) => formatNumeric(row.input_tokens),
    measureText: (row) => formatNumeric(row.input_tokens),
  },
  {
    key: "output_tokens",
    label: "Output tokens",
    defaultWidth: 118,
    headerAlign: "right",
    cellClassName: "text-right text-slate-700",
    renderCell: (row) => formatNumeric(row.output_tokens),
    measureText: (row) => formatNumeric(row.output_tokens),
  },
  {
    key: "route",
    label: "Route",
    defaultWidth: 170,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => formatNullable(row.route),
    measureText: (row) => formatNullable(row.route),
  },
  {
    key: "service",
    label: "Service",
    defaultWidth: 120,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => formatNullable(row.service),
    measureText: (row) => formatNullable(row.service),
  },
  {
    key: "user_id",
    label: "User ID",
    defaultWidth: 180,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => truncateMiddle(row.user_id),
    measureText: (row) => truncateMiddle(row.user_id),
    title: (row) => row.user_id ?? "",
  },
  {
    key: "room_id",
    label: "Room ID",
    defaultWidth: 180,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => truncateMiddle(row.room_id),
    measureText: (row) => truncateMiddle(row.room_id),
    title: (row) => row.room_id ?? "",
  },
  {
    key: "version_id",
    label: "Version ID",
    defaultWidth: 180,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => truncateMiddle(row.version_id),
    measureText: (row) => truncateMiddle(row.version_id),
    title: (row) => row.version_id ?? "",
  },
  {
    key: "asset_id",
    label: "Asset ID",
    defaultWidth: 180,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => truncateMiddle(row.asset_id),
    measureText: (row) => truncateMiddle(row.asset_id),
    title: (row) => row.asset_id ?? "",
  },
  {
    key: "request_id",
    label: "Request ID",
    defaultWidth: 185,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => truncateMiddle(row.request_id),
    measureText: (row) => truncateMiddle(row.request_id),
    title: (row) => row.request_id ?? "",
  },
  {
    key: "attempt_id",
    label: "Attempt ID",
    defaultWidth: 185,
    headerAlign: "left",
    cellClassName: "text-slate-700",
    renderCell: (row) => truncateMiddle(row.attempt_id),
    measureText: (row) => truncateMiddle(row.attempt_id),
    title: (row) => row.attempt_id ?? "",
  },
];

function getDefaultColumnWidths(): Record<LedgerColumnKey, number> {
  return LEDGER_COLUMNS.reduce<Record<LedgerColumnKey, number>>((acc, column) => {
    acc[column.key] = column.defaultWidth;
    return acc;
  }, {} as Record<LedgerColumnKey, number>);
}

export default function GeminiUsageLedger() {
  const [windowPreset, setWindowPreset] = useState<LedgerWindowPreset>("this-month");
  const [customStartDate, setCustomStartDate] = useState<string>(() =>
    toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  );
  const [customStartTime, setCustomStartTime] = useState("00:00");
  const [customEndDate, setCustomEndDate] = useState<string>(() => toDateInputValue(new Date()));
  const [customEndTime, setCustomEndTime] = useState("23:59");

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState<LedgerPageSize>(25);
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<LedgerColumnKey, number>>(
    () => getDefaultColumnWidths()
  );

  const latestColumnWidthsRef = useRef(columnWidths);
  const dragStateRef = useRef<{
    pointerId: number;
    key: LedgerColumnKey;
    startX: number;
    startWidth: number;
    minWidth: number;
    handleElement: HTMLSpanElement;
  } | null>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const page = useMemo(() => Math.floor(offset / pageSize) + 1, [offset, pageSize]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / pageSize)), [totalCount, pageSize]);
  const totalColumnWidth = useMemo(
    () =>
      LEDGER_COLUMNS.reduce(
        (sum, column) => sum + (columnWidths[column.key] ?? column.defaultWidth),
        0
      ),
    [columnWidths]
  );

  const debugResizeLog = useCallback((message: string, payload: Record<string, unknown>) => {
    if (typeof window === "undefined") return;
    const enabled = window.localStorage.getItem(RESIZE_DEBUG_STORAGE_KEY) === "1";
    if (!enabled) return;
    console.debug(`[gemini-ledger-resize-debug] ${message}`, payload);
  }, []);

  useEffect(() => {
    latestColumnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  const persistColumnWidths = useCallback((widths: Record<LedgerColumnKey, number>) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const defaults = getDefaultColumnWidths();
      const next = { ...defaults };
      for (const column of LEDGER_COLUMNS) {
        const raw = parsed[column.key];
        if (typeof raw === "number" && Number.isFinite(raw)) {
          const minWidth = Math.max(MIN_COLUMN_WIDTH, column.minWidth ?? MIN_COLUMN_WIDTH);
          next[column.key] = Math.max(minWidth, Math.trunc(raw));
        }
      }
      setColumnWidths(next);
    } catch {
      // Ignore malformed persisted widths.
    }
  }, []);

  const measureTextWidth = useCallback((text: string, font: string): number => {
    if (typeof document === "undefined") return text.length * 8;
    if (!measureCanvasRef.current) {
      measureCanvasRef.current = document.createElement("canvas");
    }
    const ctx = measureCanvasRef.current.getContext("2d");
    if (!ctx) return text.length * 8;
    ctx.font = font;
    return ctx.measureText(text).width;
  }, []);

  const resetColumnWidths = useCallback(() => {
    const defaults = getDefaultColumnWidths();
    setColumnWidths(defaults);
    persistColumnWidths(defaults);
  }, [persistColumnWidths]);

  const handleColumnAutoFit = useCallback(
    (column: LedgerColumnConfig, font: string) => {
      const minWidth = Math.max(MIN_COLUMN_WIDTH, column.minWidth ?? MIN_COLUMN_WIDTH);
      const longest = Math.max(
        measureTextWidth(column.label, font),
        ...rows.map((row) => measureTextWidth(column.measureText(row), font))
      );
      const autoFitWidth = Math.min(MAX_AUTO_FIT_WIDTH, Math.max(minWidth, Math.ceil(longest + AUTO_FIT_PADDING)));
      const previousWidth = latestColumnWidthsRef.current[column.key] ?? column.defaultWidth;
      debugResizeLog("doubleclick-autofit", {
        column: column.key,
        previousWidth,
        nextWidth: autoFitWidth,
        totalColumnWidthBefore: totalColumnWidth,
      });
      setColumnWidths((prev) => {
        const next = { ...prev, [column.key]: autoFitWidth };
        persistColumnWidths(next);
        return next;
      });
    },
    [debugResizeLog, measureTextWidth, persistColumnWidths, rows, totalColumnWidth]
  );

  const stopColumnResize = useCallback(() => {
    const state = dragStateRef.current;
    if (!state) return;
    dragStateRef.current = null;
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    if (state.handleElement.hasPointerCapture(state.pointerId)) {
      state.handleElement.releasePointerCapture(state.pointerId);
    }
    persistColumnWidths(latestColumnWidthsRef.current);
  }, [persistColumnWidths]);

  useEffect(() => {
    return () => {
      stopColumnResize();
    };
  }, [stopColumnResize]);

  const handleColumnResizeMove = useCallback((event: React.PointerEvent<HTMLSpanElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (event.pointerId !== state.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.clientX - state.startX;
    const nextWidth = Math.max(state.minWidth, Math.trunc(state.startWidth + delta));
    const previousWidth = latestColumnWidthsRef.current[state.key] ?? state.startWidth;
    debugResizeLog("pointermove", {
      column: state.key,
      previousWidth,
      nextWidth,
      startWidth: state.startWidth,
      clientX: event.clientX,
    });
    setColumnWidths((prev) => ({ ...prev, [state.key]: nextWidth }));
  }, [debugResizeLog]);

  const handleColumnResizeEnd = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const state = dragStateRef.current;
      if (!state) return;
      if (event.pointerId !== state.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      debugResizeLog("pointerup", {
        column: state.key,
        finalWidth: latestColumnWidthsRef.current[state.key] ?? state.startWidth,
      });
      stopColumnResize();
    },
    [debugResizeLog, stopColumnResize]
  );

  const handleColumnAutoFitFromEvent = useCallback(
    (event: React.SyntheticEvent<HTMLSpanElement>, column: LedgerColumnConfig) => {
      event.preventDefault();
      event.stopPropagation();
      const headerElement = event.currentTarget.parentElement;
      const computed = headerElement ? window.getComputedStyle(headerElement) : null;
      const font = computed?.font || "500 12px sans-serif";
      handleColumnAutoFit(column, font);
    },
    [handleColumnAutoFit]
  );

  const handleColumnResizeStart = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>, column: LedgerColumnConfig) => {
      if (event.button !== 0) return;
      if (event.detail >= 2) {
        debugResizeLog("pointerdown-doubleclick-branch", {
          column: column.key,
          width: latestColumnWidthsRef.current[column.key] ?? column.defaultWidth,
        });
        handleColumnAutoFitFromEvent(event, column);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      stopColumnResize();

      const minWidth = Math.max(MIN_COLUMN_WIDTH, column.minWidth ?? MIN_COLUMN_WIDTH);
      const startWidth = latestColumnWidthsRef.current[column.key] ?? column.defaultWidth;
      const handleElement = event.currentTarget;
      handleElement.setPointerCapture(event.pointerId);
      debugResizeLog("pointerdown", {
        column: column.key,
        pointerId: event.pointerId,
        startWidth,
        minWidth,
      });
      if (typeof document !== "undefined") {
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
      }
      dragStateRef.current = {
        pointerId: event.pointerId,
        key: column.key,
        startX: event.clientX,
        startWidth,
        minWidth,
        handleElement,
      };
    },
    [debugResizeLog, handleColumnAutoFitFromEvent, stopColumnResize]
  );

  const buildQueryString = useCallback(
    (includePagination: boolean) => {
      const range = resolveWindowRange({
        preset: windowPreset,
        customStartDate,
        customStartTime,
        customEndDate,
        customEndTime,
      });
      if ("error" in range) return range;

      const params = new URLSearchParams();
      params.set("from", range.fromIso);
      params.set("to", range.toIso);
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }
      if (includePagination) {
        params.set("limit", String(pageSize));
        params.set("offset", String(offset));
      }
      return {
        queryString: params.toString(),
      };
    },
    [customEndDate, customEndTime, customStartDate, customStartTime, offset, pageSize, searchQuery, windowPreset]
  );

  const loadLedger = useCallback(async () => {
    const queryArgs = buildQueryString(true);
    if ("error" in queryArgs) {
      setError(queryArgs.error);
      setRows([]);
      setTotalCount(0);
      setHasNext(false);
      setHasPrevious(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/gemini-usage/ledger?${queryArgs.queryString}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as LedgerResponse;
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load Gemini usage ledger.");
      }
      const normalized = normalizeLedgerResponse(payload);
      setRows(normalized.rows);
      setTotalCount(normalized.totalCount);
      setHasNext(normalized.hasNext);
      setHasPrevious(normalized.hasPrevious);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Gemini usage ledger.");
      setRows([]);
      setTotalCount(0);
      setHasNext(false);
      setHasPrevious(false);
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  const handleExportCsv = useCallback(async () => {
    const queryArgs = buildQueryString(false);
    if ("error" in queryArgs) {
      setError(queryArgs.error);
      return;
    }
    setIsExporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/gemini-usage/ledger/export?${queryArgs.queryString}`, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to export ledger CSV.");
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || "vibode-gemini-usage-ledger.csv";
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export ledger CSV.");
    } finally {
      setIsExporting(false);
    }
  }, [buildQueryString]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-50">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Gemini Usage Ledger</h1>
              <p className="mt-1 text-sm text-slate-400">
                Running audit trail of Gemini API calls (timestamps shown in Pacific time).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/gemini-usage"
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Back to analytics
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
                  onChange={(event) => {
                    setWindowPreset(event.target.value as LedgerWindowPreset);
                    setOffset(0);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="this-month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="all-time">All time</option>
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
                      onChange={(event) => {
                        setCustomStartDate(event.target.value);
                        setOffset(0);
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">Start time (PT)</span>
                    <input
                      type="time"
                      value={customStartTime}
                      onChange={(event) => {
                        setCustomStartTime(event.target.value);
                        setOffset(0);
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">End date</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(event) => {
                        setCustomEndDate(event.target.value);
                        setOffset(0);
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-400">End time (PT)</span>
                    <input
                      type="time"
                      value={customEndTime}
                      onChange={(event) => {
                        setCustomEndTime(event.target.value);
                        setOffset(0);
                      }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">Search</span>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="email, user id, model, route..."
                  className="w-72 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery(searchInput.trim());
                  setOffset(0);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                  setOffset(0);
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={isExporting}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
              >
                {isExporting ? "Exporting..." : "Export current ledger CSV"}
              </button>
              <button
                type="button"
                onClick={() => void loadLedger()}
                disabled={isLoading}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
              >
                {isLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              Showing {rows.length.toLocaleString()} row(s) of {totalCount.toLocaleString()} total.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetColumnWidths}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
              >
                Reset widths
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <span>Page size</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    const nextSize = Number.parseInt(event.target.value, 10);
                    if (nextSize === 25 || nextSize === 50 || nextSize === 100) {
                      setPageSize(nextSize);
                      setOffset(0);
                    }
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-500"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setOffset((current) => Math.max(0, current - pageSize))}
                disabled={!hasPrevious || isLoading}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-slate-600">
                Page {page.toLocaleString()} / {totalPages.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setOffset((current) => current + pageSize)}
                disabled={!hasNext || isLoading}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table
              className="min-w-full table-fixed border-collapse text-xs"
              style={{ width: `${totalColumnWidth}px` }}
            >
              <colgroup>
                {LEDGER_COLUMNS.map((column) => (
                  <col
                    key={column.key}
                    style={{
                      width: `${columnWidths[column.key] ?? column.defaultWidth}px`,
                      minWidth: `${Math.max(MIN_COLUMN_WIDTH, column.minWidth ?? MIN_COLUMN_WIDTH)}px`,
                    }}
                  />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700">
                <tr>
                  {LEDGER_COLUMNS.map((column) => {
                    const alignClass = column.headerAlign === "right" ? "text-right" : "text-left";
                    return (
                      <th
                        key={column.key}
                        className={`relative border-b border-slate-200 px-3 py-2 font-medium ${alignClass}`}
                      >
                        <span>{column.label}</span>
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          title="Drag to resize, double-click to auto-fit"
                          className={`pointer-events-auto absolute right-0 top-0 z-30 h-full ${RESIZE_HANDLE_HIT_WIDTH_CLASS} cursor-col-resize select-none touch-none hover:bg-slate-300/50`}
                          onPointerDown={(event) => handleColumnResizeStart(event, column)}
                          onPointerMove={handleColumnResizeMove}
                          onPointerUp={handleColumnResizeEnd}
                          onPointerCancel={handleColumnResizeEnd}
                          onLostPointerCapture={handleColumnResizeEnd}
                          onDoubleClick={(event) => handleColumnAutoFitFromEvent(event, column)}
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  return (
                    <tr
                      key={`${row.created_at ?? "no-created"}:${row.request_id ?? "no-request"}:${row.attempt_id ?? "no-attempt"}`}
                      className="odd:bg-white even:bg-slate-50 hover:bg-slate-100/80"
                    >
                      {LEDGER_COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className={`border-b border-slate-200 px-3 py-2 ${column.cellClassName}`}
                          title={column.title ? column.title(row) : undefined}
                        >
                          {column.renderCell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={LEDGER_COLUMNS.length} className="px-3 py-6 text-center text-slate-500">
                      No ledger events in selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
