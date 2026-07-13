import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

const heartbeat = vi.hoisted(() => ({ cancelRun: vi.fn() }));
vi.mock("./heartbeat.js", () => ({ heartbeatService: () => heartbeat }));

import { projectTaskArchivalService } from "./project-task-archival.js";

type Row = {
  id: string;
  status: string;
  hiddenAt: Date | null;
  checkoutRunId: string | null;
  executionRunId: string | null;
};

function fakeDb(initial: Row[]) {
  const rows = initial.map((row) => ({ ...row }));
  let updateCalls = 0;
  const db: any = {
    select: () => ({ from: () => ({ where: async () => rows.map((row) => ({ ...row })) }) }),
    update: () => ({
      set: () => ({
        where: async () => {
          updateCalls += 1;
          const now = new Date();
          for (const row of rows) {
            if (row.status !== "done" && row.status !== "cancelled") row.status = "cancelled";
            row.hiddenAt = now;
            row.checkoutRunId = null;
            row.executionRunId = null;
          }
        },
      }),
    }),
  };
  db.transaction = async (callback: (tx: typeof db) => unknown) => callback(db);
  return { db: db as Db, rows, getUpdateCalls: () => updateCalls };
}

describe("projectTaskArchivalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeat.cancelRun.mockImplementation(async (runId: string) => ({ id: runId, status: "cancelled" }));
  });

  it("previews open, completed, hidden, and active-run task counts", async () => {
    const { db } = fakeDb([
      { id: "open", status: "in_progress", hiddenAt: null, checkoutRunId: "run-1", executionRunId: "run-1" },
      { id: "done", status: "done", hiddenAt: null, checkoutRunId: null, executionRunId: null },
      { id: "cancelled", status: "cancelled", hiddenAt: new Date(), checkoutRunId: null, executionRunId: null },
    ]);
    await expect(projectTaskArchivalService(db).preview("project-1", "company-1")).resolves.toMatchObject({
      totalCount: 3, openCount: 1, doneCount: 1, cancelledCount: 1, hiddenCount: 1, activeRunCount: 1,
    });
  });

  it("cancels unique runs, preserves done tasks, cancels open tasks, and hides all tasks", async () => {
    const { db, rows, getUpdateCalls } = fakeDb([
      { id: "open", status: "in_progress", hiddenAt: null, checkoutRunId: "run-1", executionRunId: "run-1" },
      { id: "todo", status: "todo", hiddenAt: null, checkoutRunId: null, executionRunId: "run-2" },
      { id: "done", status: "done", hiddenAt: null, checkoutRunId: null, executionRunId: null },
    ]);
    const result = await projectTaskArchivalService(db).archive("project-1", "company-1");
    expect(heartbeat.cancelRun.mock.calls.map(([id]) => id)).toEqual(["run-1", "run-2"]);
    expect(heartbeat.cancelRun).toHaveBeenCalledWith("run-1", expect.stringContaining("project-1"));
    expect(rows.find((row) => row.id === "done")?.status).toBe("done");
    expect(rows.filter((row) => row.id !== "done").every((row) => row.status === "cancelled")).toBe(true);
    expect(rows.every((row) => row.hiddenAt instanceof Date)).toBe(true);
    expect(getUpdateCalls()).toBe(1);
    expect(result).toMatchObject({ totalCount: 3, newlyCancelledCount: 2, newlyHiddenCount: 3, cancelledTaskRunCount: 2 });
  });

  it("fails before mutating tasks when active-run cancellation fails", async () => {
    const { db, rows, getUpdateCalls } = fakeDb([
      { id: "open", status: "in_progress", hiddenAt: null, checkoutRunId: "run-1", executionRunId: null },
    ]);
    heartbeat.cancelRun.mockRejectedValue(new Error("cancel failed"));
    await expect(projectTaskArchivalService(db).archive("project-1", "company-1")).rejects.toThrow("cancel failed");
    expect(getUpdateCalls()).toBe(0);
    expect(rows[0]).toMatchObject({ status: "in_progress", hiddenAt: null });
  });
});
