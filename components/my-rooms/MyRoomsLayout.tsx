"use client";

import type { ReactNode } from "react";

type MyRoomsLayoutProps = {
  sidebar: ReactNode;
  header: ReactNode;
  contextBar: ReactNode;
  grid: ReactNode;
};

export function MyRoomsLayout({ sidebar, header, contextBar, grid }: MyRoomsLayoutProps) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1440px] gap-6 px-4 py-6 lg:px-6">
        <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
        <section className="min-w-0 flex-1">
          {header}
          {contextBar}
          {grid}
        </section>
      </div>
    </main>
  );
}
