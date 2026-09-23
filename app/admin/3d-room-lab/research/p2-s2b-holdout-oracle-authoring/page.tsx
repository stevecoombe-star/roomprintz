import { notFound } from "next/navigation";

import HoldoutOracleAuthoringClient from "./HoldoutOracleAuthoringClient";

export const metadata = {
  title: "P2-S2B Blind Oracle Authoring",
};

export default function P2S2BHoldoutOracleAuthoringPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HoldoutOracleAuthoringClient />;
}
