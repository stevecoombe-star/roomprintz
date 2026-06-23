import ThreeRoomLab from "./ThreeRoomLab";
import { isAutoFloorVisionEnabled, isEmptyRoomAssistEnabled } from "@/lib/vibodeAutoFloorVisionConfig";

export default function AdminThreeRoomLabPage() {
  // Server-only feature flags; the client never reads env. We pass only derived
  // booleans so the lab can conditionally expose experimental controls. The
  // routes remain the hard security gates regardless of these values.
  const visionEnabled = isAutoFloorVisionEnabled();
  const emptyRoomAssistEnabled = isEmptyRoomAssistEnabled();
  return <ThreeRoomLab visionEnabled={visionEnabled} emptyRoomAssistEnabled={emptyRoomAssistEnabled} />;
}
