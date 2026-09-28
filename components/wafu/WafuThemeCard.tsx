'use client';

import type { WafuPreference } from '@/lib/wafu/theme';

const options: ReadonlyArray<{ id: WafuPreference; label: string; note: string; mark: string }> = [
  { id: 'classic', label: '經典', note: '原本的淺色介面', mark: 'O' },
  { id: 'kikyo', label: '桔梗', note: '夜的書齋 · 紺與金', mark: '桔' },
  { id: 'shigure', label: '時雨', note: '雪夜湯宿 · 青與琥珀', mark: '雨' },
  { id: 'random', label: '隨機', note: '每次開啟時選一個', mark: '？' },
];

/** Settings card for the interface theme. Only the look changes; data and features stay the same. */
export default function WafuThemeCard({ preference, onChange }: { preference: WafuPreference; onChange: (preference: WafuPreference) => void }) {
  const current = options.find((option) => option.id === preference) ?? options[0];
  return <section className={`settings-feature-card wafu-settings-card ${preference !== 'classic' ? 'is-enabled' : ''}`}>
    <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">和</span><div><p>Interface theme</p><h3>和風介面</h3></div><span className="settings-feature-status">{current.label}</span></div>
    <p>桔梗與時雨兩個深色主題：明朝字體、角色光環與和紙質感。只改外觀，資料與功能完全相同；選擇保存在這個瀏覽器。</p>
    <div className="wafu-theme-options" role="radiogroup" aria-label="介面主題">
      {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={preference === option.id} className={`wafu-theme-option ${preference === option.id ? 'active' : ''}`} onClick={() => onChange(option.id)}>
        <span className={`wafu-swatch is-${option.id}`} aria-hidden="true">{option.mark}</span>
        <span><b>{option.label}</b><small>{option.note}</small></span>
      </button>)}
    </div>
  </section>;
}
