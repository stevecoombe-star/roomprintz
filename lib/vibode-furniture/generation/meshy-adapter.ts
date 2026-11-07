/**
 * Typed Meshy 7.1 adapter. The API key stays in the injected transport.
 * This module does not read the environment and does not call the network.
 */

import {
  MESHY_CREATE_TIMEOUT_MS,
  MESHY_GET_TIMEOUT_MS,
  MESHY_POLL_DEFAULT_MS,
  meshyPollWaitMs,
} from "./policy";
import type { MeshyCreateRequest } from "./payload";
import {
  headerValue,
  normalizeMeshyHttpFailure,
  parseMeshyTask,
  parseMeshyTaskId,
  type MeshyTask,
  type MeshyTransport,
} from "./meshy-task";
import type { MeshyGenerationOperation } from "./credits";

export type MeshyCreateOutcome =
  | Readonly<{ kind: "created"; taskId: string }>
  | Readonly<{
    kind: "rejected";
    errorClass: "provider_rejected" | "provider_payment" | "provider_auth" | "provider_forbidden" | "rate_limited";
    errorCode: string;
    message: string;
    retryAfterMs: number | null;
  }>
  | Readonly<{ kind: "ambiguous"; errorCode: string; message: string }>;

export type MeshyReadOutcome =
  | Readonly<{ kind: "task"; task: MeshyTask; retryAfterMs: number }>
  | Readonly<{ kind: "retry"; errorCode: string; retryAfterMs: number }>
  | Readonly<{ kind: "missing" }>;

export type MeshyListOutcome =
  | Readonly<{ kind: "page"; tasks: readonly MeshyTask[]; pageFull: boolean }>
  | Readonly<{ kind: "retry" }>;

export type MeshyAdapter = {
  createTask(request: MeshyCreateRequest): Promise<MeshyCreateOutcome>;
  getTask(operation: MeshyGenerationOperation, taskId: string): Promise<MeshyReadOutcome>;
  listRecentTasks(operation: MeshyGenerationOperation): Promise<MeshyListOutcome>;
};

const LIST_PAGE_SIZE = 50;

const DEFINITE_CREATE_REJECTIONS = [
  "provider_rejected",
  "provider_payment",
  "provider_auth",
  "provider_forbidden",
  "rate_limited",
] as const;

function definiteCreateRejection(
  errorClass: string,
): (typeof DEFINITE_CREATE_REJECTIONS)[number] | null {
  return (DEFINITE_CREATE_REJECTIONS as readonly string[]).includes(errorClass)
    ? errorClass as (typeof DEFINITE_CREATE_REJECTIONS)[number]
    : null;
}

export function createMeshyAdapter(transport: MeshyTransport): MeshyAdapter {
  return {
    async createTask(request) {
      const response = await transport.request({
        method: "POST",
        path: request.path,
        body: request.body,
        timeoutMs: MESHY_CREATE_TIMEOUT_MS,
      });
      if (response.kind === "timeout" || response.kind === "network") {
        return {
          kind: "ambiguous",
          errorCode: response.kind === "timeout" ? "create_timeout" : "create_network",
          message: "Meshy did not confirm that the task was created.",
        };
      }
      if (response.unparsed || response.status >= 500) {
        return {
          kind: "ambiguous",
          errorCode: response.unparsed ? "create_unparsed" : `http_${response.status}`,
          message: "Meshy did not confirm that the task was created.",
        };
      }
      if (response.status >= 200 && response.status < 300) {
        const taskId = parseMeshyTaskId(response.body);
        if (!taskId) {
          return {
            kind: "ambiguous",
            errorCode: "create_missing_task_id",
            message: "Meshy did not confirm that the task was created.",
          };
        }
        return { kind: "created", taskId };
      }
      const failure = normalizeMeshyHttpFailure({
        status: response.status,
        body: response.body,
        method: "POST",
      });
      const errorClass = definiteCreateRejection(failure.errorClass);
      if (!errorClass || failure.ambiguous) {
        return { kind: "ambiguous", errorCode: failure.errorCode, message: failure.message };
      }
      return {
        kind: "rejected",
        errorClass,
        errorCode: failure.errorCode,
        message: failure.message,
        retryAfterMs: errorClass === "rate_limited"
          ? meshyPollWaitMs(headerValue(response.headers, "retry-after"))
          : null,
      };
    },
    async getTask(operation, taskId) {
      if (!/^[A-Za-z0-9-]{8,80}$/.test(taskId)) return { kind: "missing" };
      const response = await transport.request({
        method: "GET",
        path: `/v1/${operation}/${taskId}`,
        timeoutMs: MESHY_GET_TIMEOUT_MS,
      });
      if (response.kind !== "response" || response.unparsed || response.status >= 500 || response.status === 429) {
        const header = response.kind === "response" ? headerValue(response.headers, "retry-after") : null;
        return { kind: "retry", errorCode: "status_unconfirmed", retryAfterMs: meshyPollWaitMs(header) };
      }
      if (response.status === 404) return { kind: "missing" };
      if (response.status !== 200) {
        return { kind: "retry", errorCode: `http_${response.status}`, retryAfterMs: MESHY_POLL_DEFAULT_MS };
      }
      const task = parseMeshyTask(response.body);
      if (!task || task.id !== taskId) {
        return { kind: "retry", errorCode: "status_unparsed", retryAfterMs: MESHY_POLL_DEFAULT_MS };
      }
      return {
        kind: "task",
        task,
        retryAfterMs: meshyPollWaitMs(headerValue(response.headers, "retry-after")),
      };
    },
    async listRecentTasks(operation) {
      const response = await transport.request({
        method: "GET",
        path: `/v1/${operation}?page_size=${LIST_PAGE_SIZE}&sort_by=-created_at`,
        timeoutMs: MESHY_GET_TIMEOUT_MS,
      });
      if (response.kind !== "response" || response.unparsed || response.status !== 200 || !Array.isArray(response.body)) {
        return { kind: "retry" };
      }
      const tasks: MeshyTask[] = [];
      for (const item of response.body) {
        const task = parseMeshyTask(item);
        if (task) tasks.push(task);
      }
      return { kind: "page", tasks, pageFull: response.body.length >= LIST_PAGE_SIZE };
    },
  };
}
