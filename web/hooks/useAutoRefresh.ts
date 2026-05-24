import { useEffect, useRef } from "react";

export function useAutoRefresh(callback: () => void, intervalMs = 5000): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    function schedule() {
      id = setTimeout(() => {
        cbRef.current();
        schedule();
      }, intervalMs);
    }
    schedule();
    return () => clearTimeout(id);
  }, [intervalMs]);
}
