import { useLayoutEffect, useState } from "react";

/** 量測容器寬度（整數像素，讓 SVG 線條與文字落在像素格上） */
export function useElementWidth(min = 240): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = (width: number) => setW(Math.max(min, Math.floor(width)));
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) measure(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [setEl, w];
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
