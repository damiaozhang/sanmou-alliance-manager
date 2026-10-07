import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** Persist a small string UI state in the URL while preserving other parameters. */
export function useUrlState(param: string, initial = ""): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(param) ?? initial;

  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          if (!next || next === initial) updated.delete(param);
          else updated.set(param, next);
          return updated;
        },
        { replace: true },
      );
    },
    [initial, param, setSearchParams],
  );

  return [value, setValue];
}
