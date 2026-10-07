// lib/sort 单测（阶段4 自 helpers.test.ts 迁移）

import { describe, it, expect } from "vitest";
import { sortRows, type SortState } from "./sort";

describe('sortRows', () => {
  const rows = [
    { id: "a", score: 10 },
    { id: "b", score: 30 },
    { id: "c", score: 20 },
  ];

  it('sorts descending by key', () => {
    const sortDesc: SortState<"score"> = { key: "score", direction: "desc" };
    const sorted = sortRows(rows, sortDesc, (r, k) => r[k]);
    expect(sorted[0].id).toBe("b");
    expect(sorted[1].id).toBe("c");
    expect(sorted[2].id).toBe("a");
  });

  it('sorts ascending by key', () => {
    const sortAsc: SortState<"score"> = { key: "score", direction: "asc" };
    const sorted = sortRows(rows, sortAsc, (r, k) => r[k]);
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("c");
    expect(sorted[2].id).toBe("b");
  });

  it('handles empty array', () => {
    const sortDesc: SortState<"score"> = { key: "score", direction: "desc" };
    const sorted = sortRows([], sortDesc, (r, k) => r[k]);
    expect(sorted.length).toBe(0);
  });
});
