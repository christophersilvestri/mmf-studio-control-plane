import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";
import { conflict } from "../errors.js";
import { heartbeatService } from "./heartbeat.js";

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

export interface ProjectTaskArchivePreview {
  projectId: string;
  totalCount: number;
  openCount: number;
  doneCount: number;
  cancelledCount: number;
  hiddenCount: number;
  activeRunCount: number;
}

export interface ProjectTaskArchiveResult extends ProjectTaskArchivePreview {
  newlyCancelledCount: number;
  newlyHiddenCount: number;
  cancelledTaskRunCount: number;
}

export function projectTaskArchivalService(db: Db) {
  const heartbeat = heartbeatService(db);

  async function listProjectTasks(projectId: string, companyId: string) {
    return db
      .select({
        id: issues.id,
        status: issues.status,
        hiddenAt: issues.hiddenAt,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId)));
  }

  function summarize(projectId: string, rows: Awaited<ReturnType<typeof listProjectTasks>>): ProjectTaskArchivePreview {
    const activeRunIds = new Set<string>();
    for (const row of rows) {
      if (row.checkoutRunId) activeRunIds.add(row.checkoutRunId);
      if (row.executionRunId) activeRunIds.add(row.executionRunId);
    }
    return {
      projectId,
      totalCount: rows.length,
      openCount: rows.filter((row) => !TERMINAL_ISSUE_STATUSES.has(row.status)).length,
      doneCount: rows.filter((row) => row.status === "done").length,
      cancelledCount: rows.filter((row) => row.status === "cancelled").length,
      hiddenCount: rows.filter((row) => row.hiddenAt !== null).length,
      activeRunCount: activeRunIds.size,
    };
  }

  async function preview(projectId: string, companyId: string) {
    return summarize(projectId, await listProjectTasks(projectId, companyId));
  }

  async function archive(projectId: string, companyId: string): Promise<ProjectTaskArchiveResult> {
    const rows = await listProjectTasks(projectId, companyId);
    const before = summarize(projectId, rows);
    const runIds = [...new Set(rows.flatMap((row) => [row.checkoutRunId, row.executionRunId]).filter((id): id is string => Boolean(id)))];
    let cancelledTaskRunCount = 0;
    // Heartbeat cancellation is an external side effect and cannot be rolled back by the
    // issue transaction. Cancel first and fail closed: task rows are untouched if any
    // required run cancellation throws.
    for (const runId of runIds) {
      const cancelled = await heartbeat.cancelRun(runId, `Cancelled because project ${projectId} tasks were archived`);
      if (cancelled?.status === "cancelled") cancelledTaskRunCount += 1;
    }

    const now = new Date();
    if (rows.length > 0) {
      await db.transaction(async (tx) => {
        await tx
          .update(issues)
          .set({
            status: sql<string>`case when ${issues.status} in ('done', 'cancelled') then ${issues.status} else 'cancelled' end`,
            cancelledAt: sql<Date | null>`case when ${issues.status} = 'done' then ${issues.cancelledAt} else coalesce(${issues.cancelledAt}, ${now}) end`,
            hiddenAt: now,
            checkoutRunId: null,
            executionRunId: null,
            executionLockedAt: null,
            updatedAt: now,
          })
          .where(and(eq(issues.companyId, companyId), eq(issues.projectId, projectId)));
      });
    }

    const afterRows = await listProjectTasks(projectId, companyId);
    const invalid = afterRows.filter((row) => row.hiddenAt === null || !TERMINAL_ISSUE_STATUSES.has(row.status));
    if (invalid.length > 0) {
      throw conflict("Project task archival verification failed", { issueIds: invalid.map((row) => row.id) });
    }
    return {
      ...summarize(projectId, afterRows),
      newlyCancelledCount: before.openCount,
      newlyHiddenCount: before.totalCount - before.hiddenCount,
      cancelledTaskRunCount,
    };
  }

  return { preview, archive };
}
