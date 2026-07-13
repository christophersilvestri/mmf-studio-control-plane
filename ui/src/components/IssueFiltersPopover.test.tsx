// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultIssueFilterState } from "../lib/issue-filters";
import { IssueFiltersPopover } from "./IssueFiltersPopover";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("IssueFiltersPopover project lifecycle filtering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
  });

  it("hides archived projects and clears an archived project selection", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <IssueFiltersPopover
          state={{ ...defaultIssueFilterState, projects: ["archived-project"] }}
          onChange={onChange}
          activeFilterCount={1}
          projects={[
            { id: "active-project", name: "Active Project", archivedAt: null },
            { id: "archived-project", name: "Archived Project", archivedAt: "2026-07-13T16:43:49.791Z" },
          ]}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ projects: [] });
    });

    const trigger = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Filters"));
    expect(trigger).toBeTruthy();
    await act(async () => trigger?.click());

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Active Project");
    });
    expect(document.body.textContent).not.toContain("Archived Project");
  });
});
