import ThreeRoomLab from "./ThreeRoomLab";
import { isAutoFloorVisionEnabled } from "@/lib/vibodeAutoFloorVisionConfig";

export default function AdminThreeRoomLabPage() {
  // Server-only feature flag; the client never reads env. We pass only a derived
  // boolean so the lab can conditionally expose the experimental vision provider.
  const visionEnabled = isAutoFloorVisionEnabled();
  return <ThreeRoomLab visionEnabled={visionEnabled} />;
}
