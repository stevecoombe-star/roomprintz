import type { Metadata } from "next";

import RoomLabV2 from "./RoomLabV2";

export const metadata: Metadata = {
  title: "AFC v2 Room Lab",
  description: "Clean AFC v2 architecture shell",
};

export default function AdminAfcV2Page() {
  return <RoomLabV2 />;
}
