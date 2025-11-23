// app/page.tsx
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-50">
      <div className="max-w-2xl text-center px-4">
        <h1 className="text-4xl md:text-5xl font-semibold mb-4">
          RoomPrintz (Private Beta)
        </h1>
        <p className="text-lg text-slate-300 mb-8">
          Upload any room. Choose a style. Generate AI-staged interiors in seconds.
        </p>
        <button className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium transition">
          Get Started
        </button>
      </div>
    </main>
  );
}
