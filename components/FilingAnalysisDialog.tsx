'use client';

import { useState } from 'react';
import type { AiProvider } from '@/lib/earnings';
import type { AiKeys, CompanyFilings, EarningsFiling, FilingAnalysis, QuarterRow } from '@/lib/filings';
import { aiKeyHeaders, maxFollowUps, maxQuestionLength } from '@/lib/filings';
import type { AiStatus } from '@/components/AiSettingsCard';

type Props = {
  symbol: string;
  company: CompanyFilings;
  status: AiStatus;
  keys: AiKeys;
  defaultProvider: AiProvider;
  openAiModel: string;
  questions: string[];
  analyses: Record<string, FilingAnalysis>;
  onSave: (analysis: FilingAnalysis) => void;
  onClose: () => void;
};

type AiResponse = { provider?: AiProvider; model?: string; text?: string; form?: string; filed?: string; documentUrl?: string; figures?: QuarterRow[]; error?: string };

// Event handlers stamp results with the time they arrive.
const timestamp = () => Date.now();
const providerName = (provider: AiProvider) => provider === 'anthropic' ? 'Claude' : 'ChatGPT';
const formLabel = (filing: EarningsFiling) => filing.form.startsWith('8-K') ? `${filing.form} 財報新聞稿` : filing.form === '10-K' ? '10-K 年報' : '10-Q 季報';
const compactMoney = (value: number) => {
  const abs = Math.abs(value);
  return `${value < 0 ? '−' : ''}$${abs >= 1e9 ? `${(abs / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M` : abs.toFixed(0)}`;
};

/** Headings, bullets and paragraphs from the model's plain-text answer; no HTML is interpreted. */
function AnalysisText({ text }: { text: string }) {
  return <div className="filing-analysis-text">
    {text.split('\n').map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      if (/^#{1,4}\s/.test(trimmed)) return <h4 key={index}>{trimmed.replace(/^#{1,4}\s+/, '')}</h4>;
      if (/^([-*•]|\d+[.)])\s/.test(trimmed)) return <p key={index} className="is-item">{trimmed.replace(/^[-*•]\s+/, '• ').replace(/\*\*/g, '')}</p>;
      return <p key={index}>{trimmed.replace(/\*\*/g, '')}</p>;
    })}
  </div>;
}

function FiguresTable({ figures }: { figures: QuarterRow[] }) {
  if (!figures.length) return null;
  return <div className="filing-figures">
    <table>
      <caption>SEC XBRL 季度數字</caption>
      <thead><tr><th>季末日</th><th>營收</th><th>稀釋 EPS</th><th>毛利率</th></tr></thead>
      <tbody>{[...figures].reverse().map((row) => <tr key={row.end}>
        <td>{row.end}{row.derived ? '＊' : ''}</td>
        <td>{row.revenue ? compactMoney(row.revenue.value) : '—'}</td>
        <td>{row.epsDiluted ? `$${row.epsDiluted.value.toFixed(2)}` : '—'}</td>
        <td>{row.grossMargin === null ? '—' : `${(row.grossMargin * 100).toFixed(1)}%`}</td>
      </tr>)}</tbody>
    </table>
    {figures.some((row) => row.derived) && <small>＊ 第四季以全年減前三季推算。</small>}
  </div>;
}

export default function FilingAnalysisDialog({ symbol, company, status, keys, defaultProvider, openAiModel, questions, analyses, onSave, onClose }: Props) {
  const filings = [company.earningsRelease, company.periodicReport].filter((filing): filing is EarningsFiling => Boolean(filing));
  const [accession, setAccession] = useState(filings[0]?.accession ?? '');
  const [provider, setProvider] = useState<AiProvider>(defaultProvider);
  const [busy, setBusy] = useState<'analysis' | 'question' | null>(null);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const filing = filings.find((candidate) => candidate.accession === accession) ?? filings[0];
  const analysis = filing ? analyses[filing.accession] : undefined;
  const hasKey = (candidate: AiProvider) => Boolean(keys[candidate].trim()) || (status?.state === 'ok' && status.providers[candidate]);
  const blocker = status === null ? '確認登入狀態中…'
    : status.state === 'error' ? status.message
    : !status.sec ? '伺服器尚未設定 SEC_CONTACT，財報解讀停用。'
    : !hasKey(provider) ? `尚未設定 ${providerName(provider)} 金鑰，請到「設定 → AI 設定」輸入。`
    : provider === 'openai' && !(openAiModel.trim() || status.openAiModel) ? '請先在「AI 設定」填入 ChatGPT 模型名稱。'
    : '';

  const call = async (task: 'earnings-analysis' | 'filing-question', extra: Record<string, unknown>) => {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aiKeyHeaders(keys) },
      body: JSON.stringify({ task, symbol, provider, accession: filing!.accession, model: provider === 'openai' ? openAiModel.trim() : undefined, ...extra }),
    });
    const payload = await response.json() as AiResponse;
    if (!response.ok || !payload.text) throw new Error(payload.error ?? '產生失敗，請稍後再試。');
    return payload;
  };

  const generate = async () => {
    if (!filing || blocker) return;
    setBusy('analysis');
    setError('');
    try {
      const payload = await call('earnings-analysis', { questions });
      onSave({
        symbol, accession: filing.accession, form: payload.form ?? filing.form, filed: payload.filed ?? filing.filed,
        documentUrl: payload.documentUrl ?? filing.url, provider, model: payload.model ?? '', text: payload.text!,
        figures: payload.figures ?? [], createdAt: timestamp(), followUps: [],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '產生失敗，請稍後再試。');
    } finally {
      setBusy(null);
    }
  };

  const ask = async () => {
    const text = question.trim().slice(0, maxQuestionLength * 2);
    if (!analysis || !text || blocker) return;
    setBusy('question');
    setError('');
    try {
      const payload = await call('filing-question', { question: text, history: analysis.followUps });
      onSave({ ...analysis, followUps: [...analysis.followUps, { question: text, answer: payload.text!, provider, model: payload.model ?? '', at: timestamp() }] });
      setQuestion('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '追問失敗，請稍後再試。');
    } finally {
      setBusy(null);
    }
  };

  return <div className="modal-backdrop filing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="filing-modal" role="dialog" aria-modal="true" aria-labelledby="filing-modal-title">
      <header>
        <div><p className="eyebrow">Earnings filing</p><h2 id="filing-modal-title">財報解讀 · {symbol}</h2><span>{company.name}</span></div>
        <button className="close-button" type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="關閉財報解讀">×</button>
      </header>
      <div className="filing-modal-body">
        {!filings.length ? <p className="filing-empty">SEC 上找不到這家公司最近的財報申報。</p> : <>
          <div className="filing-choices" role="radiogroup" aria-label="選擇 SEC 文件">
            {filings.map((candidate) => <label key={candidate.accession} className={candidate.accession === filing?.accession ? 'active' : ''}>
              <input type="radio" name="filing" checked={candidate.accession === filing?.accession} onChange={() => { setAccession(candidate.accession); setError(''); }} />
              <b>{formLabel(candidate)}</b><span>{candidate.filed} 申報{analyses[candidate.accession] ? ' · 已解讀' : ''}</span>
              <a href={candidate.url} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>SEC 原文</a>
            </label>)}
          </div>
          <div className="filing-toolbar">
            <label><span>使用</span>
              <select value={provider} disabled={Boolean(busy)} onChange={(event) => setProvider(event.target.value === 'anthropic' ? 'anthropic' : 'openai')}>
                <option value="openai">ChatGPT</option>
                <option value="anthropic">Claude</option>
              </select>
            </label>
            <button type="button" className="primary-button" disabled={Boolean(blocker) || Boolean(busy)} onClick={generate}>{busy === 'analysis' ? '產生中…（約 30–90 秒）' : analysis ? '重新產生分析' : '產生分析'}</button>
          </div>
          {blocker && <p className="filing-blocker">{blocker}</p>}
          {error && <p className="filing-error" role="alert">{error}</p>}
          {analysis && <article className="filing-analysis">
            <p className="filing-analysis-meta">{providerName(analysis.provider)} · {analysis.model} · {new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(analysis.createdAt))} · <a href={analysis.documentUrl} target="_blank" rel="noreferrer noopener">分析依據的 SEC 文件</a></p>
            <AnalysisText text={analysis.text} />
            <FiguresTable figures={analysis.figures} />
            <div className="filing-followups">
              <h4>追問</h4>
              {analysis.followUps.map((exchange, index) => <div className="filing-exchange" key={`${exchange.at}-${index}`}>
                <p className="question">Q：{exchange.question}</p>
                <AnalysisText text={exchange.answer} />
                <small>{providerName(exchange.provider)} · {exchange.model}</small>
              </div>)}
              {analysis.followUps.length < maxFollowUps ? <form className="filing-ask" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
                <textarea rows={2} value={question} maxLength={maxQuestionLength * 2} placeholder="針對這份財報繼續發問…" aria-label="追問問題" onChange={(event) => setQuestion(event.target.value)} />
                <button type="submit" className="primary-button" disabled={Boolean(blocker) || Boolean(busy) || !question.trim()}>{busy === 'question' ? '回答中…' : '送出'}</button>
              </form> : <small>這份財報已達追問上限（{maxFollowUps} 次）。</small>}
            </div>
          </article>}
          <p className="filing-footnote">分析與追問只存在這個瀏覽器，超過半年自動刪除。內容由 AI 根據 SEC 文件產生，可能有誤，不是投資建議。</p>
        </>}
      </div>
    </section>
  </div>;
}
