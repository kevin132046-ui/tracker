import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./wa";

/** 數字補間：開場揭幕時由 0 滾動到目標值，之後每次更新平滑過渡 */
export function useTween(target: number, opts: { from?: number; start?: boolean; duration?: number } = {}) {
  const { from, start = true, duration = 950 } = opts;
  const [v, setV] = useState(from ?? target);
  const prev = useRef(from ?? target);
  useEffect(() => {
    if (!start) return;
    if (prefersReducedMotion()) { prev.current = target; setV(target); return; }
    const a = prev.current, b = target, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 4);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else prev.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); prev.current = b; };
  }, [target, start, duration]);
  return v;
}
