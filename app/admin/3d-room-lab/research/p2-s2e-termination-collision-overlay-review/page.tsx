import { notFound } from "next/navigation";

import {
  P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS,
  type P2S2ETerminationCollisionReviewRecord,
  type P2S2ETerminationCollisionReviewRoomId,
} from "../p2-s2e-termination-collision-overlay-review";
import {
  loadP2S2ETerminationCollisionReviewRecord,
} from "../p2-s2e-termination-collision-overlay-review-server";
import TerminationCollisionOverlayReviewClient from "./TerminationCollisionOverlayReviewClient";

export const metadata = {
  title: "P2-S2E Termination Collision Overlay Review",
};

export default async function P2S2ETerminationCollisionOverlayReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const loaded = await Promise.all(
    P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS.map(async roomId => ({
      roomId,
      result: await loadP2S2ETerminationCollisionReviewRecord(roomId),
    }))
  );
  const failed = loaded.find(item => !item.result.ok);
  if (failed) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <section className="mx-auto max-w-2xl rounded border border-amber-700 bg-amber-950/20 p-5">
          <h1 className="font-semibold">P2-S2E review unavailable</h1>
          <p className="mt-2 font-mono text-sm text-amber-100">
            {failed.roomId}: {failed.result.ok ? "" : failed.result.code}
          </p>
        </section>
      </main>
    );
  }
  const records = Object.fromEntries(loaded.map(item => [
    item.roomId,
    (item.result as Readonly<{
      ok: true;
      record: P2S2ETerminationCollisionReviewRecord;
    }>).record,
  ])) as Record<
    P2S2ETerminationCollisionReviewRoomId,
    P2S2ETerminationCollisionReviewRecord
  >;
  return <TerminationCollisionOverlayReviewClient records={records} />;
}
