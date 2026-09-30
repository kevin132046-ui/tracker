'use client';

import { useState } from 'react';
import type { WafuIntroPreference } from '@/lib/wafu/intro';
import { introLiteDetected, setIntroLiteDetected } from '@/lib/wafu/intro';
import type { WafuPreference } from '@/lib/wafu/theme';

const options: ReadonlyArray<{ id: WafuPreference; label: string; note: string; mark: string }> = [
  { id: 'kikyo', label: '桔梗', note: '夜的書齋 · 紺與金', mark: '桔' },
  { id: 'shigure', label: '時雨', note: '雪夜湯宿 · 青與琥珀', mark: '雨' },
  { id: 'random', label: '隨機', note: '每次開啟時選一個', mark: '？' },
];
const introOptions: ReadonlyArray<{ id: WafuIntroPreference; label: string }> = [
  { id: 'always', label: '每次開啟' },
  { id: 'session', label: '每個分頁一次' },
  { id: 'off', label: '關閉' },
];

/** Settings card for the interface theme (桔梗, 時雨 or random) and its opening. */
export default function WafuThemeCard({ preference, onChange, intro, onIntroChange, liteAuto, onLiteAutoChange, onPreviewIntro }: {
  preference: WafuPreference;
  onChange: (preference: WafuPreference) => void;
  intro: WafuIntroPreference;
  onIntroChange: (preference: WafuIntroPreference) => void;
  liteAuto: boolean;
  onLiteAutoChange: (on: boolean) => void;
  onPreviewIntro: () => void;
}) {
  const current = options.find((option) => option.id === preference) ?? options[0];
  // The card only renders inside the open settings panel, so storage is safe to read here.
  const [liteDetected, setLiteDetected] = useState(introLiteDetected);
  return <section className="settings-feature-card wafu-settings-card is-enabled">
    <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">和</span><div><p>Interface theme</p><h3>和風介面</h3></div><span className="settings-feature-status">{current.label}</span></div>
    <p>桔梗與時雨兩個主題：明朝字體、角色光環與和紙質感。兩者只差外觀，資料與功能完全相同；選擇保存在這個瀏覽器。</p>
    <div className="wafu-theme-options" role="radiogroup" aria-label="介面主題">
      {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={preference === option.id} className={`wafu-theme-option ${preference === option.id ? 'active' : ''}`} onClick={() => onChange(option.id)}>
        <span className={`wafu-swatch is-${option.id}`} aria-hidden="true">{option.mark}</span>
        <span><b>{option.label}</b><small>{option.note}</small></span>
      </button>)}
    </div>
    <div className="wafu-intro-settings">
      <div className="wafu-intro-row">
        <span id="wafu-intro-label">開場動畫</span>
        <div className="wafu-intro-choices" role="radiogroup" aria-labelledby="wafu-intro-label">
          {introOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={intro === option.id} className={intro === option.id ? 'active' : ''} onClick={() => onIntroChange(option.id)}>{option.label}</button>)}
        </div>
        <button type="button" className="wafu-intro-preview" onClick={onPreviewIntro}>預覽開場</button>
      </div>
      <label className="wafu-intro-lite"><input type="checkbox" checked={liteAuto} onChange={(event) => onLiteAutoChange(event.target.checked)} /><span>裝置較慢時自動改用輕量開場（不顯示水墨）</span></label>
      {liteAuto && liteDetected && <p className="wafu-intro-note">這台裝置已改用輕量開場。<button type="button" onClick={() => { setIntroLiteDetected(false); setLiteDetected(false); }}>重新偵測</button></p>}
    </div>
  </section>;
}
