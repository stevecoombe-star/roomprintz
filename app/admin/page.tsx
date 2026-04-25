const ADMIN_PLACEHOLDER_CARDS = [
  "Beta access code management - coming soon",
  "Recent signups - coming soon",
  "Recently active users - coming soon",
  "Reports - coming soon",
  "Token activity - coming soon",
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Vibode Admin</h1>
          <p className="text-sm text-slate-400">
            Closed beta admin dashboard placeholder. More controls will be added incrementally.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ADMIN_PLACEHOLDER_CARDS.map((label) => (
            <article
              key={label}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300"
            >
              {label}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
