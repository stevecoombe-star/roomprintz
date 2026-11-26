import { notFound } from "next/navigation";

/**
 * Server gate for the Design Studio segment.
 *
 * `next dev` compiles this with NODE_ENV set to development. `next build` and
 * `next start` compile and run it as production. Next inlines that value into
 * the production server bundle, so there is no public variable and no
 * production flag that can turn the route on. Every other environment
 * responds with notFound().
 */
export function assertDesignStudioDevelopmentOnly(): void {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
}
