import type { Metadata } from "next";

import RoomLabV2 from "./RoomLabV2";

export const metadata: Metadata = {
  title: "AFC v2 Room Lab",
  description: "Certified AFC v2 floor and camera calibration",
};

export default function AdminAfcV2Page() {
  return <RoomLabV2 />;
}
