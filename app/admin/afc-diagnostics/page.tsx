import { Suspense } from "react";

import AfcDiagnosticCaseInbox from "./AfcDiagnosticCaseInbox";
import { AFC_DIAGNOSTIC_INBOX_COPY } from "@/lib/afc-v2-diagnostics/admin-case-inbox.client";

export default function AfcDiagnosticsAdminPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
          <div className="mx-auto w-full max-w-7xl space-y-6">
            <p className="text-sm text-slate-400">{AFC_DIAGNOSTIC_INBOX_COPY.loading}</p>
          </div>
        </main>
      }
    >
      <AfcDiagnosticCaseInbox />
    </Suspense>
  );
}
