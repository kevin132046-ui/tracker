import type { ReactNode } from 'react';

/**
 * Side-navigation icons: flat geometric marks in the Swiss manner (24px grid; circles, squares and
 * bars, mostly filled). Each item's colour comes from app/wafu-nav-icons.css.
 */
const Svg = ({ name, children }: { name: string; children: ReactNode }) => (
  <svg className={`wafu-nav-icon ni-${name}`} viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none" aria-hidden="true">{children}</svg>
);

export type WafuNavIconName = 'settings' | 'overview' | 'positions' | 'returns' | 'valuation' | 'ai' | 'background' | 'saving';

const ring = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6 } as const;

const icons: Record<WafuNavIconName, ReactNode> = {
  // A ring with four teeth: the gear reduced to its geometry.
  settings: <><circle cx="12" cy="12" r="6" {...ring} /><rect x="10.5" y="1.5" width="3" height="4" /><rect x="10.5" y="18.5" width="3" height="4" /><rect x="1.5" y="10.5" width="4" height="3" /><rect x="18.5" y="10.5" width="4" height="3" /><circle cx="12" cy="12" r="2" /></>,
  // Four fields, one filled.
  overview: <><rect x="2.5" y="2.5" width="8.5" height="8.5" /><rect x="13" y="2.5" width="8.5" height="8.5" {...ring} strokeWidth={2} /><rect x="2.5" y="13" width="8.5" height="8.5" {...ring} strokeWidth={2} /><rect x="13" y="13" width="8.5" height="8.5" {...ring} strokeWidth={2} /></>,
  // Holdings as bars of falling length.
  positions: <><rect x="2.5" y="3" width="19" height="4.2" /><rect x="2.5" y="9.9" width="13" height="4.2" /><rect x="2.5" y="16.8" width="7" height="4.2" /></>,
  // A rising diagonal ending in a solid triangle.
  returns: <><path d="M3 21 15.5 8.5" fill="none" stroke="currentColor" strokeWidth={2.8} /><path d="M10.5 3H21v10.5Z" /><rect x="2.5" y="19.5" width="19" height="2" opacity=".35" /></>,
  // Value as a half-filled circle on its axis.
  valuation: <><circle cx="12" cy="12" r="9" {...ring} strokeWidth={2.2} /><path d="M12 3a9 9 0 0 0 0 18Z" /><rect x="11" y="1" width="2" height="22" /></>,
  // An eye: a ring with its pupil off-centre.
  ai: <><circle cx="12" cy="12" r="9" {...ring} strokeWidth={2.2} /><circle cx="14.5" cy="9.5" r="4" /><rect x="3.5" y="19" width="5" height="2.5" opacity=".5" /></>,
  // A picture: frame, sun, mountain.
  background: <><rect x="2.5" y="2.5" width="19" height="19" {...ring} strokeWidth={2} /><circle cx="16.5" cy="7.5" r="2.6" /><path d="M2.5 21.5 10 10.5l7.5 11Z" /></>,
  saving: <><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth={2.4} strokeDasharray="3 3" /></>,
};

export default function NavIcon({ name }: { name: WafuNavIconName }) {
  return <Svg name={name}>{icons[name]}</Svg>;
}
