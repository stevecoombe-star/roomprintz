import { notFound } from "next/navigation";

import {
  P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS,
  type P2S2FWorldBlockerReviewRecord,
  type P2S2FWorldBlockerReviewRoomId,
} from "../p2-s2f-world-blocker-overlay-review";
import {
  loadP2S2FWorldBlockerReviewRecord,
} from "../p2-s2f-world-blocker-overlay-review-server";
import WorldBlockerOverlayReviewClient from "./WorldBlockerOverlayReviewClient";

export const metadata = {
  title: "P2-S2F World Blocker Overlay Review",
};

export default async function P2S2FWorldBlockerOverlayReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const loaded = await Promise.all(
    P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS.map(async roomId => ({
      roomId,
      result: await loadP2S2FWorldBlockerReviewRecord(roomId),
    }))
  );
  const failed = loaded.find(item => !item.result.ok);
  if (failed) {
    return (
      <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
        <section className="mx-auto max-w-2xl rounded border border-amber-700 bg-amber-950/20 p-5">
          <h1 className="font-semibold">P2-S2F review unavailable</h1>
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
      record: P2S2FWorldBlockerReviewRecord;
    }>).record,
  ])) as Record<
    P2S2FWorldBlockerReviewRoomId,
    P2S2FWorldBlockerReviewRecord
  >;
  return <WorldBlockerOverlayReviewClient records={records} />;
}
