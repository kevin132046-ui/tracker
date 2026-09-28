import type { ReactNode } from "react";

export interface SegOption<T extends string> { v: T; label: string; title?: string }

/** 分段控制：桔梗＝底線式、時雨＝膠囊式（由 research.css 依主題切換） */
export function Seg<T extends string>({ value, options, onChange, label, small, className }: {
  value: T | null;
  options: ReadonlyArray<SegOption<T>>;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={`rs-seg${small ? " rs-seg-sm" : ""}${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" className={o.v === value ? "on" : ""} aria-pressed={o.v === value} title={o.title} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PanelHead({ eyebrow, title, id, meta, aside }: { eyebrow: string; title: ReactNode; id: string; meta?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="rs-phead">
      <div className="rs-phead-main">
        <p className="rs-eyebrow">{eyebrow}</p>
        <h3 id={id}>{title}</h3>
        {meta && <p className="rs-meta">{meta}</p>}
      </div>
      {aside}
    </header>
  );
}

type IconName = "close" | "import" | "save" | "load" | "trash" | "reset" | "arrow" | "warn";

const PATHS: Record<IconName, ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  import: <><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  save: <><path d="M5.5 4.5h10l3 3v12h-13z" /><path d="M8.5 4.5v4.5h6.5V4.5" /><path d="M8.5 19.5v-5h7v5" /></>,
  load: <><path d="M4.5 7.5h6l2 2h7v9.5h-15z" /><path d="M12 12v5M9.8 14.8L12 17l2.2-2.2" /></>,
  trash: <><path d="M5 7h14" /><path d="M9.5 7V4.8h5V7" /><path d="M7 7l.9 12.2h8.2L17 7" /></>,
  reset: <><path d="M5.5 9A7 7 0 1 1 5 13.5" /><path d="M5 4.5V9h4.5" /></>,
  arrow: <><path d="M5 12h13" /><path d="M13.5 7.5L18 12l-4.5 4.5" /></>,
  warn: <><path d="M12 4.5l8.5 15h-17z" /><path d="M12 10v4.2M12 16.8v.2" /></>,
};

export function RIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="rs-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
