// 通用排序工具（阶段4 自 helpers.ts 拆出）

export type SortDirection = "asc" | "desc";
export type SortState<K extends string> = { key: K; direction: SortDirection };

export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, valueFn: (row: T, key: K) => number) {
  return [...rows].sort((left, right) => {
    const delta = valueFn(left, sort.key) - valueFn(right, sort.key);
    return sort.direction === "desc" ? -delta : delta;
  });
}
