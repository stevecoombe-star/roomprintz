"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createBrowserPartnerInlineGlbTransport,
  createPartnerInlineUploadSession,
  runPartnerInlineGlbUpload,
  type PartnerInlineGlbView,
} from "@/lib/vibode-stage/partner-inline-glb-upload";

const IDLE: PartnerInlineGlbView = { phase: "idle" };

export function usePartnerInlineGlbUploads() {
  const sessions = useRef(new Map<string, ReturnType<typeof createPartnerInlineUploadSession>>());
  const [views, setViews] = useState<Record<string, PartnerInlineGlbView>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  const sessionFor = useCallback((target: string) => {
    const existing = sessions.current.get(target);
    if (existing) return existing;
    const created = createPartnerInlineUploadSession();
    sessions.current.set(target, created);
    return created;
  }, []);

  const run = useCallback(async (target: string, file: File) => {
    const session = sessionFor(target);
    const token = session.tryStart();
    if (token == null) return { status: "ignored" as const };
    const publish = (view: PartnerInlineGlbView) => {
      if (!session.isCurrent(token)) return;
      setViews((current) => ({ ...current, [target]: view }));
    };
    publish({ phase: "uploading", fileName: file.name });
    try {
      const result = await runPartnerInlineGlbUpload({
        file,
        transport: createBrowserPartnerInlineGlbTransport(file),
        isCurrent: () => session.isCurrent(token),
        onPhase: (phase, fileName) => publish({ phase, fileName }),
      });
      if (!session.isCurrent(token) || (!result.ok && result.stage === "cancelled")) {
        return { status: "stale" as const, token };
      }
      if (!result.ok) {
        publish({
          phase: "attention",
          fileName: file.name,
          message: result.message,
          technical: result.technical,
          reload: false,
        });
        return { status: "failed" as const, token };
      }
      if (session.isCurrent(token)) {
        try {
          const glbBytes = await file.arrayBuffer();
          if (session.isCurrent(token)) {
            const { generatePartnerModelThumbnail } = await import(
              "@/lib/vibode-model-thumbnail/generate-client"
            );
            await generatePartnerModelThumbnail({
              assetId: result.asset.assetId,
              glbBytes,
            });
          }
        } catch {
          // Registration already succeeded. A missing thumbnail can be retried.
        }
      }
      publish({ phase: "ready", fileName: result.asset.originalFileName });
      return {
        status: "ready" as const,
        token,
        assetId: result.asset.assetId,
        fileName: result.asset.originalFileName,
      };
    } finally {
      session.finish(token);
    }
  }, [sessionFor]);

  const showAttention = useCallback((
    target: string,
    view: Extract<PartnerInlineGlbView, { phase: "attention" }>,
  ) => {
    setViews((current) => ({ ...current, [target]: view }));
  }, []);

  const settle = useCallback((target: string) => {
    setViews((current) => ({ ...current, [target]: IDLE }));
  }, []);

  const invalidate = useCallback((target: string) => {
    sessionFor(target).invalidate();
    setViews((current) => ({ ...current, [target]: IDLE }));
  }, [sessionFor]);

  const remember = useCallback((assetId: string, fileName: string) => {
    const trimmed = fileName.trim();
    if (!assetId || !trimmed) return;
    setNames((current) => (current[assetId] === trimmed ? current : { ...current, [assetId]: trimmed }));
  }, []);

  useEffect(() => {
    const active = Object.values(views).some((view) => (
      view.phase === "uploading" || view.phase === "processing"
    ));
    if (!active || typeof window === "undefined") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [views]);

  return {
    view(target: string): PartnerInlineGlbView {
      return views[target] ?? IDLE;
    },
    fileName(assetId: string): string | null {
      return names[assetId] ?? null;
    },
    busy(target: string): boolean {
      const phase = views[target]?.phase;
      return phase === "uploading" || phase === "processing";
    },
    anyBusy(): boolean {
      return Object.values(views).some((view) => view.phase === "uploading" || view.phase === "processing");
    },
    isCurrent(target: string, token: number): boolean {
      return sessionFor(target).isCurrent(token);
    },
    run,
    showAttention,
    settle,
    invalidate,
    remember,
  };
}
