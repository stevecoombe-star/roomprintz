/**
 * Authorize one claimed Clean Up job for the dedicated worker.
 *
 * The worker process is already the service-role caller. This check is the
 * room-ownership gate: the lookup must return the room's current owner.
 * A job id is not an input. Administrator email is not consulted.
 * A missing room, a lookup error, or a different owner fails closed.
 */
export type CleanupWorkerOwnershipLookup = (input: Readonly<{
  userId: string;
  roomId: string;
}>) => Promise<{
  data: { ownerId: string } | null;
  error: unknown;
}>;

export async function authorizeCleanupWorkerClaim(
  lookup: CleanupWorkerOwnershipLookup,
  claim: Readonly<{ userId: string; roomId: string }>,
): Promise<boolean> {
  const userId = claim.userId.trim();
  const roomId = claim.roomId.trim();
  if (!userId || !roomId) return false;
  try {
    const result = await lookup({ userId, roomId });
    if (result.error || !result.data?.ownerId) return false;
    return result.data.ownerId === userId;
  } catch {
    return false;
  }
}
