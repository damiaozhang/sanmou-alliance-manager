import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Tab 深链 hook：把页面 tab 状态同步到 URL query，支持刷新/直链定位。
 *
 * 用法：
 *   const [tab, setTab] = useTabUrl("members");
 *   // setTab("binding") 会同时更新 URL ?tab=binding 并保留其他 query 参数
 */
export function useTabUrl<T extends string>(
  param: string,
  initial: T
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(param);
  const tab = (raw && (raw as T)) || initial;

  const setTab = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next === initial) {
            nextParams.delete(param);
          } else {
            nextParams.set(param, next);
          }
          return nextParams;
        },
        { replace: true }
      );
    },
    [setSearchParams, param, initial]
  );

  return [tab, setTab];
}
