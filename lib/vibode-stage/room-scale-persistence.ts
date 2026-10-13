/**
 * Debounced room-scale writes that cannot let an older PUT finish last.
 *
 * Slider edits wait for the debounce. An explicit flush cancels that wait and
 * persists the latest multiplier, then any multiplier that replaced it while
 * the request was in flight. The returned promise settles only after the
 * newest value's server response.
 */

export type RoomScaleWrite = Readonly<{
  roomId: string;
  multiplier: number;
}>;

export type RoomScalePersistence = Readonly<{
  queue: (write: RoomScaleWrite) => void;
  flush: () => Promise<boolean>;
}>;

type DesiredWrite = Readonly<{
  generation: number;
  write: RoomScaleWrite;
}>;

export function createRoomScalePersistence(input: Readonly<{
  delayMs: number;
  persist: (write: RoomScaleWrite) => Promise<boolean>;
  schedule: (run: () => void, delayMs: number) => () => void;
}>): RoomScalePersistence {
  let generation = 0;
  let desired: DesiredWrite | null = null;
  let ackedGeneration = 0;
  let catchingUp = false;
  let cancelTimer: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  function queue(write: RoomScaleWrite): void {
    desired = { generation: ++generation, write };
    if (catchingUp) return;
    cancelTimer?.();
    cancelTimer = input.schedule(() => {
      cancelTimer = null;
      void flush();
    }, input.delayMs);
  }

  function flush(): Promise<boolean> {
    cancelTimer?.();
    cancelTimer = null;
    const run = chain.then(async () => {
      catchingUp = true;
      try {
        let ok = true;
        for (;;) {
          const job = desired;
          if (!job || job.generation <= ackedGeneration) return ok;
          try {
            ok = await input.persist(job.write);
          } catch {
            ok = false;
          }
          if (ok) ackedGeneration = Math.max(ackedGeneration, job.generation);
          if (!desired || desired.generation === job.generation) return ok;
        }
      } finally {
        catchingUp = false;
      }
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return { queue, flush };
}
