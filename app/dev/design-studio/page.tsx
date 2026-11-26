import { assertDesignStudioDevelopmentOnly } from "../dev-only";
import { DesignStudio } from "./design-studio";

export const dynamic = "force-dynamic";

export default function DesignStudioPage() {
  assertDesignStudioDevelopmentOnly();
  return <DesignStudio />;
}
