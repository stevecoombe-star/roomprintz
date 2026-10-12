"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { HarmonizeExportError } from "@/lib/vibode-stage/harmonize-export";
import type { HarmonizeQaSubmission } from "@/lib/vibode-stage/harmonize-qa";

export type HarmonizeExportRunner = () => Promise<void>;

export type HarmonizeQaPackage = Readonly<{
  composite: Uint8Array;
  submission: HarmonizeQaSubmission;
}>;

export type HarmonizeQaRunner = (idempotencyKey: string) => Promise<HarmonizeQaPackage>;

export type HarmonizeQaRegistration = Readonly<{
  roomId: string;
  run: HarmonizeQaRunner;
}>;

type HarmonizeExportContextValue = Readonly<{
  ready: boolean;
  run: () => Promise<void>;
  registerRunner: (runner: HarmonizeExportRunner | null) => void;
  qaReady: boolean;
  roomId: string | null;
  runQa: (idempotencyKey: string) => Promise<HarmonizeQaPackage>;
  registerQa: (registration: HarmonizeQaRegistration | null) => void;
}>;

const HarmonizeExportContext = createContext<HarmonizeExportContextValue | null>(null);

export function HarmonizeExportProvider({ children }: { children: ReactNode }) {
  const runnerRef = useRef<HarmonizeExportRunner | null>(null);
  const qaRef = useRef<HarmonizeQaRunner | null>(null);
  const [ready, setReady] = useState(false);
  const [qaReady, setQaReady] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const registerRunner = useCallback((next: HarmonizeExportRunner | null) => {
    runnerRef.current = next;
    setReady(next != null);
  }, []);
  const registerQa = useCallback((next: HarmonizeQaRegistration | null) => {
    qaRef.current = next?.run ?? null;
    setQaReady(next != null);
    setRoomId(next?.roomId ?? null);
  }, []);
  const run = useCallback(() => {
    const current = runnerRef.current;
    if (!current) {
      return Promise.reject(new HarmonizeExportError("STAGE scene is not ready to export."));
    }
    return current();
  }, []);
  const runQa = useCallback((idempotencyKey: string) => {
    const current = qaRef.current;
    if (!current) {
      return Promise.reject(new HarmonizeExportError("STAGE scene is not ready to export."));
    }
    return current(idempotencyKey);
  }, []);
  const value = useMemo<HarmonizeExportContextValue>(() => ({
    ready,
    run,
    registerRunner,
    qaReady,
    roomId,
    runQa,
    registerQa,
  }), [ready, run, registerRunner, qaReady, roomId, runQa, registerQa]);
  return (
    <HarmonizeExportContext.Provider value={value}>
      {children}
    </HarmonizeExportContext.Provider>
  );
}

export function useHarmonizeExportControl(): Pick<HarmonizeExportContextValue, "ready" | "run"> | null {
  const value = useContext(HarmonizeExportContext);
  if (!value) return null;
  return { ready: value.ready, run: value.run };
}

export function useRegisterHarmonizeExport():
  | HarmonizeExportContextValue["registerRunner"]
  | null {
  return useContext(HarmonizeExportContext)?.registerRunner ?? null;
}

export function useHarmonizeQaControl(): Pick<
  HarmonizeExportContextValue,
  "qaReady" | "roomId" | "runQa"
> | null {
  const value = useContext(HarmonizeExportContext);
  if (!value) return null;
  return { qaReady: value.qaReady, roomId: value.roomId, runQa: value.runQa };
}

export function useRegisterHarmonizeQa():
  | HarmonizeExportContextValue["registerQa"]
  | null {
  return useContext(HarmonizeExportContext)?.registerQa ?? null;
}
