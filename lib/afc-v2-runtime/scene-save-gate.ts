/**
 * One in-flight scene save, with the latest edit replacing anything still pending.
 *
 * Saves run in submission order. A newer edit queued during a save is written
 * after that save finishes. The flush resolves only when that latest edit has
 * been acknowledged, or when the latest save failed.
 */

export type SceneSaveJob<T> = Readonly<{
  generation: number;
  value: T;
}>;

export type SceneSaveGate<T> = Readonly<{
  submit: (value: T) => Promise<boolean>;
  flush: () => Promise<boolean>;
  hasWork: () => boolean;
  superseded: (generation: number) => boolean;
}>;

export function createSceneSaveGate<T>(
  save: (job: SceneSaveJob<T>) => Promise<boolean>,
): SceneSaveGate<T> {
  let nextGeneration = 0;
  let pending: SceneSaveJob<T> | null = null;
  let gate: Promise<boolean> | null = null;
  let ackedGeneration = 0;
  let lastOk = true;

  function superseded(generation: number): boolean {
    return nextGeneration > generation;
  }

  function hasWork(): boolean {
    return gate !== null || pending !== null;
  }

  function kick(): Promise<boolean> {
    if (gate) return gate;
    if (!pending) return Promise.resolve(lastOk);
    const running = (async () => {
      try {
        while (pending) {
          const current = pending;
          pending = null;
          try {
            lastOk = await save(current);
          } catch {
            lastOk = false;
          }
          if (lastOk) ackedGeneration = Math.max(ackedGeneration, current.generation);
        }
        return lastOk;
      } finally {
        gate = null;
      }
    })();
    gate = running;
    return running;
  }

  function submit(value: T): Promise<boolean> {
    pending = { generation: ++nextGeneration, value };
    return kick();
  }

  async function flush(): Promise<boolean> {
    for (;;) {
      const target = nextGeneration;
      if (gate || pending) {
        await kick();
        continue;
      }
      if (nextGeneration !== target) continue;
      if (target === 0) return true;
      return lastOk && ackedGeneration >= target;
    }
  }

  return { submit, flush, hasWork, superseded };
}
