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
  type TesterJobPage,
  type TesterPage,
} from "@/lib/vibode-furniture/generation/admin-dashboard";

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
    />
  );
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readAdminError(body));
  return body;
}
