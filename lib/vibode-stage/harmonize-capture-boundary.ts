/**
 * Harmonize capture waits until the canonical scene and room scale are stored.
 *
 * Gesture and version checks bookend the waits. A change during preparation
 * returns without calling capture, so the caller does not upload or enqueue.
 */

export type HarmonizeCaptureBoundaryCode =
  | "gesture_active"
  | "scene_save_failed"
  | "room_scale_save_failed"
  | "capture_stale";

export function harmonizeCaptureBoundaryMessage(code: HarmonizeCaptureBoundaryCode): string {
  switch (code) {
    case "gesture_active":
      return "Finish moving the furniture before Harmonize.";
    case "scene_save_failed":
      return "The room could not be saved. Try again.";
    case "room_scale_save_failed":
      return "The room scale could not be saved. Try again.";
    case "capture_stale":
      return "The room view changed. Try Harmonize again.";
  }
}

export async function runHarmonizeCaptureBoundary<T>(input: Readonly<{
  furnitureGestureActive: () => boolean;
  sourceVersionId: () => string | null;
  sceneIdentity: () => string;
  flushScene: () => Promise<boolean>;
  flushRoomScale: () => Promise<boolean>;
  capture: () => Promise<T>;
}>): Promise<
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: HarmonizeCaptureBoundaryCode }>
> {
  if (input.furnitureGestureActive()) {
    return { ok: false, code: "gesture_active" };
  }
  const version = input.sourceVersionId();
  const identity = input.sceneIdentity();
  if (!version) return { ok: false, code: "capture_stale" };
  const sceneSaved = await input.flushScene();
  if (!sceneSaved) return { ok: false, code: "scene_save_failed" };
  const scaleSaved = await input.flushRoomScale();
  if (!scaleSaved) return { ok: false, code: "room_scale_save_failed" };
  const sceneSettled = await input.flushScene();
  if (!sceneSettled) return { ok: false, code: "scene_save_failed" };
  if (
    input.furnitureGestureActive()
    || input.sourceVersionId() !== version
    || input.sceneIdentity() !== identity
  ) {
    return { ok: false, code: "capture_stale" };
  }
  const value = await input.capture();
  if (
    input.furnitureGestureActive()
    || input.sourceVersionId() !== version
    || input.sceneIdentity() !== identity
  ) {
    return { ok: false, code: "capture_stale" };
  }
  return { ok: true, value };
}
