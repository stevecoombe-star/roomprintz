import type { ReactNode } from "react";

/** Mount Clean Up controls only after admin access has been confirmed. */
export function RemoveCleanupAdminGate({
  confirmed,
  children,
}: {
  confirmed: boolean;
  children?: ReactNode;
}): ReactNode {
  if (confirmed !== true) return null;
  return children ?? null;
}
