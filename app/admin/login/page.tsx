"use client";

import { Suspense } from "react";
import AdminLoginInner from "./AdminLoginInner";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginInner />
    </Suspense>
  );
}
