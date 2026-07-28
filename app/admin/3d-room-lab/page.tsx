import ThreeRoomLab from "./ThreeRoomLab";
import { isAutoFloorVisionEnabled, isEmptyRoomAssistEnabled } from "@/lib/vibodeAutoFloorVisionConfig";
import { isAfcUi1ProposalOverlayEnabled } from "@/lib/vibodeAfcUi1Config";
import { isAfcUi2aPreparationEnabled } from "@/lib/vibodeAfcUi2aConfig";

export default function AdminThreeRoomLabPage() {
  // Server-only feature flags; the client never reads env. We pass only derived
  // booleans so the lab can conditionally expose experimental controls. The
  // routes remain the hard security gates regardless of these values.
  const visionEnabled = isAutoFloorVisionEnabled();
  const emptyRoomAssistEnabled = isEmptyRoomAssistEnabled();
  const afcProposalOverlayEnabled = isAfcUi1ProposalOverlayEnabled();
  const afcUi2aPreparationEnabled = isAfcUi2aPreparationEnabled();
  return <ThreeRoomLab visionEnabled={visionEnabled} emptyRoomAssistEnabled={emptyRoomAssistEnabled} afcProposalOverlayEnabled={afcProposalOverlayEnabled} afcUi2aPreparationEnabled={afcUi2aPreparationEnabled} />;
}
