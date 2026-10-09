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

export type HarmonizeExportRunner = () => Promise<void>;

type HarmonizeExportContextValue = Readonly<{
  ready: boolean;
  run: () => Promise<void>;
  registerRunner: (runner: HarmonizeExportRunner | null) => void;
}>;

const HarmonizeExportContext = createContext<HarmonizeExportContextValue | null>(null);

export function HarmonizeExportProvider({ children }: { children: ReactNode }) {
  const runnerRef = useRef<HarmonizeExportRunner | null>(null);
  const [version, setVersion] = useState(0);
  const registerRunner = useCallback((next: HarmonizeExportRunner | null) => {
    runnerRef.current = next;
    setVersion((current) => current + 1);
  }, []);
  const value = useMemo<HarmonizeExportContextValue>(() => ({
    ready: runnerRef.current != null,
    run: () => {
      const current = runnerRef.current;
      if (!current) {
        return Promise.reject(new HarmonizeExportError("STAGE scene is not ready to export."));
      }
      return current();
    },
    registerRunner,
  }), [registerRunner, version]);
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
