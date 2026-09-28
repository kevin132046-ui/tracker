import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// 極座標：0° 朝上，順時針
const P = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [+(r * Math.sin(a)).toFixed(4), +(-r * Math.cos(a)).toFixed(4)] as const;
};
const pt = (deg: number, r: number) => P(deg, r).join(" ");

/** 桔梗紋外輪廓（五瓣、瓣端尖、瓣間 V 形缺口） */
export function kikyoOutline() {
  let d = `M ${pt(-36, 0.44)}`;
  for (let i = 0; i < 5; i++) {
    const a = i * 72;
    d += ` C ${pt(a - 42, 0.8)} ${pt(a - 15, 1.0)} ${pt(a, 1.04)}`;
    d += ` C ${pt(a + 15, 1.0)} ${pt(a + 42, 0.8)} ${pt(a + 36, 0.44)}`;
  }
  return d + " Z";
}

export function kikyoInner() {
  const lines: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 72;
    lines.push(`M ${pt(a + 36, 0.13)} L ${pt(a + 36, 0.44)}`); // 瓣界
    lines.push(`M ${pt(a, 0.36)} L ${pt(a, 0.74)}`); // 葉脈
  }
  return lines.join(" ");
}

export function kikyoStamen() {
  const d: string[] = [];
  for (let i = 0; i < 5; i++) d.push(`M ${pt(i * 72, 0.1)} L ${pt(i * 72, 0.25)}`);
  return d.join(" ");
}

/** 雪輪紋：六個外凸圓弧＋缺口小圓 */
export function yukiwaOutline() {
  let d = "";
  for (let i = 0; i < 6; i++) {
    const a = i * 60;
    const [sx, sy] = P(a - 30 + 7, 0.86);
    const [ex, ey] = P(a + 30 - 7, 0.86);
    const [cx, cy] = P(a, 1.2);
    d += `${i === 0 ? "M" : "L"} ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey} `;
    // 缺口：向內的小弧
    const [nx, ny] = P(a + 30, 0.74);
    const [nx2, ny2] = P(a + 30 + 7, 0.86);
    d += `Q ${nx} ${ny} ${nx2} ${ny2} `;
  }
  return d + "Z";
}

export function snowCrystal(r = 0.46) {
  const d: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60;
    d.push(`M 0 0 L ${pt(a, r)}`);
    d.push(`M ${pt(a, r * 0.55)} L ${pt(a - 28, r * 0.78)}`);
    d.push(`M ${pt(a, r * 0.55)} L ${pt(a + 28, r * 0.78)}`);
  }
  return d.join(" ");
}

export function Crest({ theme, size = 40, className, style }: { theme: "kikyo" | "shigure"; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="-1.25 -1.25 2.5 2.5" width={size} height={size} className={className} style={style} aria-hidden="true">
      {theme === "kikyo" ? (
        <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
          <path d={kikyoOutline()} strokeWidth={0.07} />
          <path d={kikyoInner()} strokeWidth={0.045} />
          <circle r={0.1} strokeWidth={0.04} />
        </g>
      ) : (
        <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
          <path d={yukiwaOutline()} strokeWidth={0.07} />
          <path d={snowCrystal(0.42)} strokeWidth={0.045} />
        </g>
      )}
    </svg>
  );
}

/** 迷你光環：用於目前頁籤與圖表端點 */
export function MiniHalo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="-12 -12 24 24" width={size} height={size} className={className} aria-hidden="true">
      <circle r={10.5} fill="none" stroke="currentColor" strokeWidth={1.1} strokeDasharray="14 2.5" opacity={0.9} />
      <circle r={7.6} fill="none" stroke="currentColor" strokeWidth={0.7} opacity={0.55} />
    </svg>
  );
}

// ——— 介面圖示（24px、線條 1.6） ———
const I = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Icon = {
  overview: (p: { size?: number }) => (
    <I {...p}><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 4v16M4 9.5h16M4 14.5h16" opacity=".75" /></I>
  ),
  positions: (p: { size?: number }) => (
    <I {...p}><rect x="4" y="7" width="16" height="13" rx="1.5" /><path d="M4 11.5h16M4 15.8h16" /><path d="M9 7c.6-2.4 5.4-2.4 6 0" /></I>
  ),
  returns: (p: { size?: number }) => (
    <I {...p}><path d="M3 18c3 0 3.5-4 6.5-4s3.4-4 6.2-4 3-3.4 5.3-4.5" /><path d="M16.5 5.2H21v4.4" /><path d="M3 21h18" opacity=".45" /></I>
  ),
  valuation: (p: { size?: number }) => (
    <I {...p}><path d="M12 4v16M8 20h8M5 7h14" /><path d="M5 7l-2.5 6h5z M19 7l-2.5 6h5z" /><circle cx="12" cy="4" r="1" /></I>
  ),
  background: (p: { size?: number }) => (
    <I {...p}><path d="M5 4h14M5 20h14" strokeWidth={2} /><rect x="6.5" y="5" width="11" height="14" /><path d="M8 16l3-4 2 2.4 1.6-1.8L16 16" /></I>
  ),
  // AI：一顆弧邊的四芒星（きらり）＋小星與光點
  ai: (p: { size?: number }) => (
    <I {...p}>
      <path d="M10 5.2C10.6 9.5 12.5 11.4 16.8 12C12.5 12.6 10.6 14.5 10 18.8C9.4 14.5 7.5 12.6 3.2 12C7.5 11.4 9.4 9.5 10 5.2Z" />
      <path d="M18 2.8C18.25 4.55 18.95 5.25 20.7 5.5C18.95 5.75 18.25 6.45 18 8.2C17.75 6.45 17.05 5.75 15.3 5.5C17.05 5.25 17.75 4.55 18 2.8Z" strokeWidth={1.3} />
      <circle cx="18.6" cy="17.6" r="0.9" fill="currentColor" stroke="none" />
    </I>
  ),
  settings: (p: { size?: number }) => (
    <I {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" /></I>
  ),
  refresh: (p: { size?: number }) => (
    <I {...p}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.8 4.2v4.3h-4.3" /></I>
  ),
  plus: (p: { size?: number }) => (
    <I {...p}><path d="M12 5v14M5 12h14" /></I>
  ),
  search: (p: { size?: number }) => (
    <I {...p}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></I>
  ),
  up: (p: { size?: number }) => (
    <I {...p}><path d="M12 19V5M6 11l6-6 6 6" /></I>
  ),
  chevron: (p: { size?: number }) => (
    <I {...p}><path d="M9 6l6 6-6 6" /></I>
  ),
  close: (p: { size?: number }) => (
    <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>
  ),
  pencil: (p: { size?: number }) => (
    <I {...p}><path d="M4 20l4.2-1 10-10a2 2 0 0 0-3.2-3.2l-10 10z" /><path d="M13.5 7.5l3 3" /></I>
  ),
};

/**
 * 元素週期表式標的方塊：左上序號、右上市場／類型、中央代號、下方分類。
 * 代號與分類在渲染後量測寬度，超出方塊時等比縮小字級，確保不會溢出。
 */
export function ElementTile({ no, symbol, tag, name, color, size = 52, hot }: {
  no?: number; symbol: string; tag?: string; name?: string; color: string; size?: number; hot?: boolean;
}) {
  const W = 52, H = 60;
  const symRef = useRef<SVGTextElement>(null);
  const nameRef = useRef<SVGTextElement>(null);
  const base = symbol.length <= 1 ? 24 : symbol.length === 2 ? 21 : symbol.length === 3 ? 17.5 : symbol.length === 4 ? 14.5 : 12.5;
  const [symFs, setSymFs] = useState(base);
  const [nameFs, setNameFs] = useState(7.6);
  const [, setTick] = useState(0);
  useEffect(() => {
    // 網頁字型載入後字寬會改變，重新量測一次
    let alive = true;
    (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => { if (alive) setTick((v) => v + 1); });
    return () => { alive = false; };
  }, []);
  useLayoutEffect(() => {
    setSymFs(base);
    setNameFs(7.6);
  }, [symbol, name, base]);
  useLayoutEffect(() => {
    const fit = (el: SVGTextElement | null, max: number, fs: number, set: (v: number) => void) => {
      if (!el) return;
      try {
        const w = el.getComputedTextLength();
        if (w > max) set(Math.max(6, (fs * max) / w));
      } catch { /* 尚未掛載 */ }
    };
    fit(symRef.current, W - 8, symFs, setSymFs);
    fit(nameRef.current, W - 7, nameFs, setNameFs);
  });
  return (
    <span className={`el${hot ? " el-hot" : ""}`} style={{ width: size, height: (size * H) / W, ["--c" as string]: color }} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
        {no != null && <text x={4.5} y={9.5} className="el-no">{String(no).padStart(2, "0")}</text>}
        {tag && <text x={W - 4.5} y={9.5} textAnchor="end" className="el-tag">{tag}</text>}
        <text ref={symRef} x={W / 2} y={name ? 35 : 38} textAnchor="middle" dominantBaseline="middle" className="el-sym" style={{ fontSize: symFs }}>{symbol}</text>
        {name && <text ref={nameRef} x={W / 2} y={52} textAnchor="middle" className="el-name" style={{ fontSize: nameFs }}>{name}</text>}
      </svg>
    </span>
  );
}
