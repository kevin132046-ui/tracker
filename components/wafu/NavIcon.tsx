import type { ReactNode } from 'react';

/**
 * Side-navigation icons in the 和風 themes: small playful objects (24px grid, 1.6 stroke), each with a
 * part that moves on hover and on the current page (app/wafu-nav-icons.css):
 * 設定 風車 (pinwheel spins) · 總覽 弁当 (the lid lifts) · 持倉 招き猫 (the paw beckons) ·
 * 收益 鯉のぼり (the carp flutter) · 估值 算盤 (beads slide) · AI 狐面 (the eyes glint) ·
 * 背景 掛軸 with Fuji (the scroll sways).
 */
const Svg = ({ name, children }: { name: string; children: ReactNode }) => (
  <svg className={`wafu-nav-icon ni-${name}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export type WafuNavIconName = 'settings' | 'overview' | 'positions' | 'returns' | 'valuation' | 'ai' | 'background' | 'saving';

const tint = { fill: 'currentColor', fillOpacity: 0.22 } as const;
const solid = { fill: 'currentColor', stroke: 'none' } as const;
const blade = 'M12 10 L12 3.2 Q16.4 3.4 15.6 7.4 Z';

const icons: Record<WafuNavIconName, ReactNode> = {
  settings: <>
    <path d="M12 10.5V21.5" />
    <g className="ni-spin">
      <path d={blade} {...tint} />
      <path d={blade} transform="rotate(90 12 10)" />
      <path d={blade} transform="rotate(180 12 10)" {...tint} />
      <path d={blade} transform="rotate(270 12 10)" />
      <circle cx="12" cy="10" r="1" {...solid} />
    </g>
  </>,
  overview: <>
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <path d="M12 8v12M12 14h9" opacity=".8" />
    <path d="M7.5 10.6 5.1 15.4h4.8Z" {...tint} />
    <path d="M6.4 15.4h2.2" strokeWidth={2.2} />
    <circle cx="16.5" cy="11" r="1.3" {...solid} />
    <path d="M14.2 17h4.6" opacity=".8" />
    <rect className="ni-lid" x="2.5" y="4.4" width="19" height="2.6" rx="1.3" {...tint} />
  </>,
  positions: <>
    <path d="M7.4 6.8 7 3.4l3 2M16.6 6.8 17 3.4l-3 2" />
    <ellipse cx="12" cy="9.6" rx="5.4" ry="4.6" />
    <path d="M9.4 9.6q.7-.7 1.4 0M13.2 9.6q.7-.7 1.4 0" />
    <path d="M7.4 13.2Q6.6 21 12 21t4.6-7.8" />
    <ellipse cx="12" cy="17.6" rx="2.1" ry="1.4" {...tint} />
    <circle cx="12" cy="14.5" r=".9" {...solid} />
    <g className="ni-paw"><path d="M16.4 13.4 18.8 8.6" /><circle cx="19.2" cy="7.4" r="1.4" {...tint} /></g>
  </>,
  returns: <>
    <path d="M4 21.5V3.5" />
    <circle cx="4" cy="2.6" r=".9" {...solid} />
    <g className="ni-flag">
      <path d="M4.6 4.4h10.6q4 0 5.4 3-1.4 3-5.4 3H4.6l2-3Z" {...tint} />
      <circle cx="17" cy="7.2" r=".75" {...solid} />
      <path d="M9 5.6q1.1 1.6 0 3.2M12 5.6q1.1 1.6 0 3.2" opacity=".7" />
    </g>
    <g className="ni-flag ni-flag-2">
      <path d="M4.6 12.4h7.6q3 0 4 2.3-1 2.3-4 2.3H4.6l1.5-2.3Z" />
      <circle cx="13.6" cy="14.4" r=".6" {...solid} />
    </g>
  </>,
  valuation: <>
    <rect x="3" y="4.5" width="18" height="15" rx="1.6" />
    <path d="M3 9.4h18" />
    <path d="M7 4.5v15M12 4.5v15M17 4.5v15" opacity=".55" />
    <g className="ni-beads">
      <ellipse cx="7" cy="7" rx="2" ry="1.1" {...tint} />
      <ellipse cx="12" cy="8.1" rx="2" ry="1.1" {...tint} />
      <ellipse cx="17" cy="7" rx="2" ry="1.1" {...tint} />
      <ellipse cx="7" cy="11.4" rx="2" ry="1.1" {...tint} />
      <ellipse cx="12" cy="14.6" rx="2" ry="1.1" {...tint} />
      <ellipse cx="17" cy="11.4" rx="2" ry="1.1" {...tint} />
      <ellipse cx="17" cy="13.6" rx="2" ry="1.1" {...tint} />
    </g>
  </>,
  ai: <>
    <path d="M5 3.6 9.2 8h5.6L19 3.6l-.4 8.2Q18.2 18 12 21q-6.2-3-6.6-9.2Z" {...tint} />
    <path d="M12 8.6v2.2" />
    <g className="ni-eyes"><path d="M7.6 12.6q1.6-1.6 3.2-.4M13.2 12.2q1.6-1.2 3.2.4" strokeWidth={1.9} /></g>
    <path d="M7 15.6l2 .4M17 15.6l-2 .4" opacity=".6" />
    <circle cx="12" cy="17.4" r=".8" {...solid} />
  </>,
  background: <>
    <g className="ni-sway">
      <path d="M9 3.2 12 1.4l3 1.8" opacity=".6" />
      <path d="M4.6 3.4h14.8" strokeWidth={2} />
      <rect x="6.4" y="3.4" width="11.2" height="16.6" />
      <path d="M8.2 16.4 11 11.6l1 .8 1-.8 2.8 4.8" />
      <path d="M10.2 13l.8.7 1-.7 1 .7.8-.7" opacity=".6" />
      <circle cx="14.8" cy="7.4" r="1.3" {...solid} />
      <path d="M5 20.6h14" strokeWidth={2} />
    </g>
  </>,
  saving: <><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /></>,
};

export default function NavIcon({ name }: { name: WafuNavIconName }) {
  return <Svg name={name}>{icons[name]}</Svg>;
}
