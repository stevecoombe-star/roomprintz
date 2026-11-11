"use client";

import { useEffect, useRef, useState } from "react";

import {
  ADMIN_UNAVAILABLE,
  parseDashboardOverview,
  parseJobDetail,
  parseTesterJobs,
  parseTesterPage,
  readAdminError,
  type DashboardOverview,
  type JobDetailRecord,
  type TesterClassification,
  type TesterJobPage,
  type TesterPage,
} from "@/lib/vibode-furniture/generation/admin-dashboard";
import { parseTesterMutation } from "@/lib/vibode-furniture/generation/admin-tester";

import {
  FurnitureGenerationDashboardView,
  type FurnitureDashboardPhase,
} from "./FurnitureGenerationDashboardView";

const TESTER_PAGE_SIZE = 25;
const JOB_PAGE_SIZE = 20;

export default function FurnitureGenerationDashboard() {
  const [phase, setPhase] = useState<FurnitureDashboardPhase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [testers, setTesters] = useState<TesterPage | null>(null);
  const [testerQuery, setTesterQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [jobs, setJobs] = useState<TesterJobPage | null>(null);
  const [jobsUserId, setJobsUserId] = useState<string | null>(null);
  const [jobsPhase, setJobsPhase] = useState<"idle" | FurnitureDashboardPhase>("idle");
  const [jobsMessage, setJobsMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetailRecord | null>(null);
  const [detailPhase, setDetailPhase] = useState<"idle" | FurnitureDashboardPhase>("idle");
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const jobsTicket = useRef(0);
  const detailTicket = useRef(0);
  const [approveEmail, setApproveEmail] = useState("");
  const [approveClassification, setApproveClassification] = useState<TesterClassification>("individual_beta");
  const [approveAllowance, setApproveAllowance] = useState("1");
  const [approveEnabled, setApproveEnabled] = useState(true);
  const [approveReason, setApproveReason] = useState("");
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState<TesterClassification>("individual_beta");
  const [editAllowance, setEditAllowance] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editReason, setEditReason] = useState("");
  const [editConfirmed, setEditConfirmed] = useState(false);
  const [managementMessage, setManagementMessage] = useState<string | null>(null);
  const [managementSaving, setManagementSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [overviewBody, testerBody] = await Promise.all([
          getJson("/api/admin/furniture-generation"),
          getJson(`/api/admin/furniture-generation/testers?limit=${TESTER_PAGE_SIZE}&offset=0`),
        ]);
        if (cancelled) return;
        const parsedOverview = parseDashboardOverview(overviewBody);
        const parsedTesters = parseTesterPage(testerBody);
        if (!parsedOverview || !parsedTesters) {
          setPhase("error");
          setMessage(ADMIN_UNAVAILABLE);
          return;
        }
        setOverview(parsedOverview);
        setTesters(parsedTesters);
        setPhase("ready");
      } catch (error) {
        if (cancelled) return;
        setPhase("error");
        setMessage(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadTesters(query: string, offset: number) {
    const params = new URLSearchParams({
      limit: String(TESTER_PAGE_SIZE),
      offset: String(offset),
    });
    if (query) params.set("q", query);
    const body = await getJson(`/api/admin/furniture-generation/testers?${params}`);
    const page = parseTesterPage(body);
    if (!page) throw new Error(ADMIN_UNAVAILABLE);
    setTesters(page);
    setAppliedQuery(query);
  }

  async function loadJobs(userId: string, offset: number) {
    const ticket = jobsTicket.current + 1;
    jobsTicket.current = ticket;
    detailTicket.current += 1;
    setJobsUserId(userId);
    setJobsPhase("loading");
    setJobsMessage(null);
    setDetail(null);
    setDetailPhase("idle");
    try {
      const params = new URLSearchParams({
        limit: String(JOB_PAGE_SIZE),
        offset: String(offset),
      });
      const body = await getJson(`/api/admin/furniture-generation/testers/${userId}/jobs?${params}`);
      if (ticket !== jobsTicket.current) return;
      const page = parseTesterJobs(body);
      if (!page || page.userId !== userId) throw new Error(ADMIN_UNAVAILABLE);
      setJobs(page);
      setJobsPhase("ready");
    } catch (error) {
      if (ticket !== jobsTicket.current) return;
      setJobs(null);
      setJobsPhase("error");
      setJobsMessage(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
    }
  }

  async function loadDetail(jobId: string) {
    const ticket = detailTicket.current + 1;
    detailTicket.current = ticket;
    setDetailPhase("loading");
    setDetailMessage(null);
    try {
      const body = await getJson(`/api/admin/furniture-generation/jobs/${jobId}`);
      if (ticket !== detailTicket.current) return;
      const parsed = parseJobDetail(body);
      if (!parsed) throw new Error(ADMIN_UNAVAILABLE);
      setDetail(parsed);
      setDetailPhase("ready");
    } catch (error) {
      if (ticket !== detailTicket.current) return;
      setDetail(null);
      setDetailPhase("error");
      setDetailMessage(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
    }
  }

  async function refreshDashboard(focusUserId: string | null) {
    const [overviewBody, testerBody] = await Promise.all([
      getJson("/api/admin/furniture-generation"),
      getJson(`/api/admin/furniture-generation/testers?limit=${TESTER_PAGE_SIZE}&offset=0${appliedQuery ? `&q=${encodeURIComponent(appliedQuery)}` : ""}`),
    ]);
    const parsedOverview = parseDashboardOverview(overviewBody);
    const parsedTesters = parseTesterPage(testerBody);
    if (!parsedOverview || !parsedTesters) throw new Error(ADMIN_UNAVAILABLE);
    setOverview(parsedOverview);
    setTesters(parsedTesters);
    if (focusUserId && focusUserId === jobsUserId) await loadJobs(focusUserId, 0);
  }

  async function approveTester() {
    const allowance = readWholeAllowance(approveAllowance);
    if (allowance == null) {
      setManagementMessage("Allowance must be a whole number from 0 to 50.");
      return;
    }
    setManagementSaving(true);
    setManagementMessage(null);
    try {
      const body = await sendJson("/api/admin/furniture-generation/testers", "POST", {
        email: approveEmail,
        classification: approveClassification,
        authorizedGenerations: allowance,
        enabled: approveEnabled,
        reason: approveReason,
        confirmed: approveConfirmed,
      });
      const saved = parseTesterMutation(body);
      if (!saved) throw new Error(ADMIN_UNAVAILABLE);
      await refreshDashboard(saved.tester.userId);
      setApproveConfirmed(false);
      setManagementMessage(saved.idempotent ? "That approval was already recorded." : "Tester access was saved.");
    } catch (error) {
      setManagementMessage(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
    } finally {
      setManagementSaving(false);
    }
  }

  async function saveTester() {
    if (!editUserId) return;
    const allowance = readWholeAllowance(editAllowance);
    if (allowance == null) {
      setManagementMessage("Allowance must be a whole number from 0 to 50.");
      return;
    }
    const current = testers?.testers.find((tester) => tester.userId === editUserId);
    if (!current) return;
    setManagementSaving(true);
    setManagementMessage(null);
    try {
      const body = await sendJson(`/api/admin/furniture-generation/testers/${editUserId}`, "PATCH", {
        classification: editClassification,
        authorizedGenerations: allowance,
        enabled: editEnabled,
        reason: editReason,
        confirmed: editConfirmed,
        expectedUpdatedAt: current.updatedAt,
      });
      const saved = parseTesterMutation(body);
      if (!saved) throw new Error(ADMIN_UNAVAILABLE);
      await refreshDashboard(saved.tester.userId);
      setEditConfirmed(false);
      setEditAllowance(String(saved.tester.authorizedGenerations));
      setEditClassification(saved.tester.classification);
      setEditEnabled(saved.tester.enabled);
      setManagementMessage(saved.unchanged ? "No tester fields changed." : "Tester access was saved.");
    } catch (error) {
      setManagementMessage(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
    } finally {
      setManagementSaving(false);
    }
  }

  return (
    <FurnitureGenerationDashboardView
      phase={phase}
      message={message}
      notice={notice}
      overview={overview}
      testers={testers}
      testerQuery={testerQuery}
      jobs={jobs}
      jobsPhase={jobsPhase}
      jobsMessage={jobsMessage}
      detail={detail}
      detailPhase={detailPhase}
      detailMessage={detailMessage}
      onQueryChange={setTesterQuery}
      onFilter={() => {
        setNotice(null);
        void loadTesters(testerQuery.trim().toLowerCase(), 0).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
        });
      }}
      onTesterPage={(offset) => {
        setNotice(null);
        void loadTesters(appliedQuery, offset).catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : ADMIN_UNAVAILABLE);
        });
      }}
      onOpenTester={(userId) => {
        void loadJobs(userId, 0);
      }}
      onJobPage={(offset) => {
        if (jobsUserId) void loadJobs(jobsUserId, offset);
      }}
      onOpenJob={(jobId) => {
        void loadDetail(jobId);
      }}
      approveEmail={approveEmail}
      approveClassification={approveClassification}
      approveAllowance={approveAllowance}
      approveEnabled={approveEnabled}
      approveReason={approveReason}
      approveConfirmed={approveConfirmed}
      editUserId={editUserId}
      editClassification={editClassification}
      editAllowance={editAllowance}
      editEnabled={editEnabled}
      editReason={editReason}
      editConfirmed={editConfirmed}
      managementMessage={managementMessage}
      managementSaving={managementSaving}
      onApproveEmail={setApproveEmail}
      onApproveClassification={setApproveClassification}
      onApproveAllowance={setApproveAllowance}
      onApproveEnabled={setApproveEnabled}
      onApproveReason={setApproveReason}
      onApproveConfirmed={setApproveConfirmed}
      onApprove={() => {
        void approveTester();
      }}
      onManageTester={(userId) => {
        const tester = testers?.testers.find((item) => item.userId === userId);
        if (!tester) return;
        setEditUserId(tester.userId);
        setEditClassification(tester.classification);
        setEditAllowance(String(tester.authorizedGenerations));
        setEditEnabled(tester.enabled);
        setEditReason("");
        setEditConfirmed(false);
        setManagementMessage(null);
      }}
      onEditClassification={setEditClassification}
      onEditAllowance={setEditAllowance}
      onEditEnabled={setEditEnabled}
      onEditReason={setEditReason}
      onEditConfirmed={setEditConfirmed}
      onSaveTester={() => {
        void saveTester();
      }}
    />
  );
}

function readWholeAllowance(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 50) return null;
  return parsed;
}

async function getJson(url: string): Promise<unknown> {
  return sendJson(url, "GET");
}

async function sendJson(url: string, method: "GET" | "POST" | "PATCH", payload?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readAdminError(body));
  return body;
}
