import { useState } from "react";
import type { SortState } from "@/lib/sort";

/**
 * 列排序三态轮换：点当前列 desc↔asc 切换，点新列回到 desc。
 * （原 MembersTab / CargoTab 内逐字重复的 toggleSort 逻辑收口。）
 */
export function useToggleSort<K extends string>(initial: SortState<K>): {
  sort: SortState<K>;
  toggle: (key: K) => void;
} {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" }
    );
  };
  return { sort, toggle };
}
