"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300";

function itemClass(current: boolean): string {
  return `rounded-md px-3 py-1.5 ${FOCUS} ${
    current
      ? "bg-slate-800 text-white"
      : "text-slate-300 hover:bg-slate-900 hover:text-white"
  }`;
}

export function PartnerPortalNav() {
  const pathname = usePathname() ?? "";
  const catalogCurrent = pathname === "/partner/catalog" || pathname.startsWith("/partner/catalog/");
  const modelsCurrent = pathname === "/partner/assets" || pathname.startsWith("/partner/assets/");

  return (
    <nav aria-label="Partner" className="flex items-center gap-1 text-sm">
      <Link
        href="/partner/catalog"
        aria-current={catalogCurrent ? "page" : undefined}
        className={itemClass(catalogCurrent)}
      >
        Catalog
      </Link>
      <Link
        href="/partner/assets"
        aria-current={modelsCurrent ? "page" : undefined}
        className={itemClass(modelsCurrent)}
      >
        3D Models
      </Link>
    </nav>
  );
}
