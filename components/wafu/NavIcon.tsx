import type { ReactNode } from 'react';

/** Line icons for the side navigation in the 和風 themes (24px grid, 1.6 stroke). */
const Svg = ({ children }: { children: ReactNode }) => (
  <svg className="wafu-nav-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export type WafuNavIconName = 'settings' | 'overview' | 'positions' | 'returns' | 'valuation' | 'background' | 'saving';

const icons: Record<WafuNavIconName, ReactNode> = {
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" /></>,
  overview: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 4v16M4 9.5h16M4 14.5h16" opacity=".75" /></>,
  positions: <><rect x="4" y="7" width="16" height="13" rx="1.5" /><path d="M4 11.5h16M4 15.8h16" /><path d="M9 7c.6-2.4 5.4-2.4 6 0" /></>,
  returns: <><path d="M3 18c3 0 3.5-4 6.5-4s3.4-4 6.2-4 3-3.4 5.3-4.5" /><path d="M16.5 5.2H21v4.4" /><path d="M3 21h18" opacity=".45" /></>,
  valuation: <><path d="M12 4v16M8 20h8M5 7h14" /><path d="M5 7l-2.5 6h5z M19 7l-2.5 6h5z" /><circle cx="12" cy="4" r="1" /></>,
  background: <><path d="M5 4h14M5 20h14" strokeWidth={2} /><rect x="6.5" y="5" width="11" height="14" /><path d="M8 16l3-4 2 2.4 1.6-1.8L16 16" /></>,
  saving: <><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /></>,
};

export default function NavIcon({ name }: { name: WafuNavIconName }) {
  return <Svg>{icons[name]}</Svg>;
}
