import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createInkEngine, type InkEngine } from "@/lib/wafu/fluid/engine";

/**
 * 水中墨 — WebGL "ink in water" layer (Stam stable fluids) for the opening.
 * Coordinates are 0..1 of the layer's box, y down.
 */
export interface InkFluidHandle {
  /** Push the water at (x, y) with velocity (dx, dy) in box-fractions per second; strength scales the ink left behind (0 = push only, default 1). */
  splat(x: number, y: number, dx: number, dy: number, strength?: number): void;
  /** An ink drop that blooms and spreads (default: random point near the centre). */
  bloom(x?: number, y?: number): void;
  /** A clockwise vortex ring that pulls ink around a circle; radius is a fraction of the box width. */
  swirl(cx: number, cy: number, radius: number): void;
}

export interface InkFluidProps {
  theme: "kikyo" | "shigure";
  /** false → stops the loop after a ~0.8s fade (stays mounted, zero work while inactive). */
  active: boolean;
  /** Goes on the wrapper div the parent positions; the canvas fills it (100% × 100%). */
  className?: string;
  /** Default true: pointer / touch moves push the water and leave a faint trail. */
  interactive?: boolean;
  /** Called once if WebGL / half-float render targets are unavailable (the layer then renders nothing). */
  onFail?: () => void;
}

const InkFluid = forwardRef<InkFluidHandle, InkFluidProps>(function InkFluid(
  { theme, active, className, interactive = true, onFail },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  const failedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ theme, active, interactive, onFail });
  useEffect(() => {
    latest.current = { theme, active, interactive, onFail };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || failedRef.current) return;
    const fail = () => {
      engineRef.current?.destroy();
      engineRef.current = null;
      if (failedRef.current) return;
      failedRef.current = true;
      setFailed(true);
      latest.current.onFail?.();
    };
    const { theme: t, active: a, interactive: i } = latest.current;
    // The engine owns a fresh <canvas> per mount, so StrictMode's mount→unmount→mount
    // can safely lose the previous context.
    const engine = createInkEngine(host, { theme: t, interactive: i, onLost: fail });
    if (!engine) {
      fail();
      return;
    }
    engineRef.current = engine;
    engine.setActive(a);
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  useEffect(() => engineRef.current?.setTheme(theme), [theme]);
  useEffect(() => engineRef.current?.setActive(active), [active]);
  useEffect(() => engineRef.current?.setInteractive(interactive), [interactive]);

  useImperativeHandle(
    ref,
    () => ({
      splat: (x, y, dx, dy, strength) => engineRef.current?.splat(x, y, dx, dy, strength),
      bloom: (x, y) => engineRef.current?.bloom(x, y),
      swirl: (cx, cy, radius) => engineRef.current?.swirl(cx, cy, radius),
    }),
    [],
  );

  if (failed) return null;
  return <div ref={hostRef} className={className} aria-hidden="true" style={{ pointerEvents: "none" }} />;
});

export default InkFluid;
