'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  addDaysToKey,
  dateKey,
  isMonthlyExpiry,
  isTradingDay,
  isWeekendKey,
  japanHolidayName,
  parseDateKey,
  previousTradingDay,
  upcomingExpiries,
  usHolidayName,
  weekday,
} from '@/lib/market-calendar';
import type { CalendarMarket } from '@/lib/market-calendar';

export type DatePickerKind = 'open' | 'expiry' | 'close';

type DatePickerProps = {
  label: string;
  /** YYYY-MM-DD, or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  todayKey: string;
  kind: DatePickerKind;
  market: CalendarMarket;
  required?: boolean;
  /** Calendar days before this are disabled; the native input keeps its own rules. */
  min?: string;
  /** Start for the expiry chips (the trade's open date). */
  referenceDate?: string;
  /** Offered as a close-date chip. */
  expiryDate?: string | null;
};

type Chip = { key: string; label: string; hint?: string; title: string };

const popoverWidth = 318;
const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
const dayMs = 86_400_000;
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
const shortDate = (key: string) => {
  const date = parseDateKey(key);
  return date ? `${date.month}/${date.day}` : key;
};
const relativeDays = (todayKey: string, key: string) => {
  const offset = daysFrom(todayKey, key);
  return offset === 0 ? '今天' : offset > 0 ? `距今 ${offset} 天` : `${-offset} 天前`;
};

/** Same day of the month `months` away, clamped to that month's length. */
function shiftMonths(key: string, months: number) {
  const date = parseDateKey(key);
  if (!date) return key;
  const index = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return dateKey(year, month, Math.min(date.day, lastDay));
}

/** Six Sunday-first weeks covering the month. */
function monthWeeks(year: number, month: number) {
  const start = addDaysToKey(dateKey(year, month, 1), -weekday({ year, month, day: 1 }));
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDaysToKey(start, week * 7 + day)));
}

function chipsFor(kind: DatePickerKind, todayKey: string, market: CalendarMarket, referenceDate?: string, expiryDate?: string | null): Chip[] {
  if (kind === 'open') {
    const previous = previousTradingDay(todayKey, market);
    return [
      { key: todayKey, label: '今天', title: `今天 ${todayKey}` },
      { key: previous, label: '上個交易日', hint: shortDate(previous), title: `${market === 'JP' ? '日股' : '美股'}上個交易日 ${previous}` },
    ];
  }
  if (kind === 'close') {
    return [
      { key: todayKey, label: '今天', title: `今天 ${todayKey}` },
      ...(parseDateKey(expiryDate) ? [{ key: expiryDate!, label: '到期日', hint: shortDate(expiryDate!), title: `到期日 ${expiryDate}` }] : []),
    ];
  }
  const base = parseDateKey(referenceDate) ? referenceDate! : todayKey;
  const { weekly, monthly } = upcomingExpiries(base);
  return [...weekly, ...(monthly ? [monthly] : [])].map((choice) => ({
    key: choice.key,
    label: shortDate(choice.key),
    hint: `${choice.monthly ? '月選' : '週選'} · ${Math.max(0, daysFrom(todayKey, choice.key))} 天`,
    title: `${choice.key}（${choice.monthly ? '月選擇權，第三個週五' : '週選擇權'}${choice.holidayAdjusted ? '，週五休市提前一天' : ''}）· ${relativeDays(todayKey, choice.key)}`,
  }));
}

/** Label-row badge for the chosen date: days to expiry, or a warning for a non-trading day. */
function badgeFor(kind: DatePickerKind, value: string, todayKey: string, market: CalendarMarket): { text: string; warning: boolean } | null {
  if (!parseDateKey(value)) return null;
  const optionMarket: CalendarMarket = kind === 'expiry' ? 'US' : market;
  const closed = isTradingDay(value, optionMarket) ? null : isWeekendKey(value) ? '週末' : `${optionMarket === 'US' ? '美股' : '日股'}休市`;
  if (kind !== 'expiry') return closed ? { text: closed, warning: true } : null;
  if (closed) return { text: `非交易日 · ${closed}`, warning: true };
  const offset = daysFrom(todayKey, value);
  const days = offset === 0 ? '今天到期' : offset > 0 ? `${offset} 天` : `已過 ${-offset} 天`;
  return { text: isMonthlyExpiry(value) ? `${days} · 月選` : days, warning: offset < 0 };
}

/**
 * Native date input plus a calendar popover: month navigation, keyboard control (arrows, Home/End,
 * PageUp/PageDown, Enter, Esc), today marker, weekends and US/JP market holidays shaded, and for
 * expiries the Fridays and monthly (third-Friday) expirations marked. Values stay YYYY-MM-DD.
 */
export default function DatePicker({ label, value, onChange, todayKey, kind, market, required = false, min, referenceDate, expiryDate }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(value || todayKey);
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const moveFocusRef = useRef(false);
  const titleId = useId();
  const focusDate = parseDateKey(focusKey) ?? parseDateKey(todayKey) ?? { year: 2026, month: 1, day: 1 };
  const weeks = useMemo(() => monthWeeks(focusDate.year, focusDate.month), [focusDate.year, focusDate.month]);
  const chips = useMemo(() => open ? chipsFor(kind, todayKey, market, referenceDate, expiryDate) : [], [expiryDate, kind, market, open, referenceDate, todayKey]);
  const badge = badgeFor(kind, value, todayKey, market);
  const disabled = (key: string) => Boolean(min && parseDateKey(min) && key < min);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const select = (key: string) => {
    if (key && disabled(key)) return;
    onChange(key);
    close(true);
  };
  const moveFocus = (key: string) => {
    moveFocusRef.current = true;
    setFocusKey(key);
  };
  const openPicker = () => {
    const root = rootRef.current;
    if (root) {
      const rect = root.getBoundingClientRect();
      const bounds = (root.closest('form') ?? document.documentElement).getBoundingClientRect();
      setAlignRight(rect.left + popoverWidth > bounds.right - 8 && rect.right - popoverWidth >= bounds.left);
    }
    moveFocus(parseDateKey(value) ? value : todayKey);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    popoverRef.current?.scrollIntoView({ block: 'nearest' });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [open]);

  useEffect(() => {
    if (!open || !moveFocusRef.current) return;
    moveFocusRef.current = false;
    popoverRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${focusKey}"]`)?.focus();
  }, [focusKey, open]);

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string | null = null;
    if (event.key in steps) next = addDaysToKey(focusKey, steps[event.key]);
    else if (event.key === 'Home') next = addDaysToKey(focusKey, -weekday(focusDate));
    else if (event.key === 'End') next = addDaysToKey(focusKey, 6 - weekday(focusDate));
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = shiftMonths(focusKey, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
    if (!next) return;
    event.preventDefault();
    moveFocus(next);
  };

  const focusInfo = (() => {
    const us = usHolidayName(focusKey);
    const jp = japanHolidayName(focusKey);
    return [
      `${focusDate.month}/${focusDate.day}（週${weekdayLabels[weekday(focusDate)]}）`,
      relativeDays(todayKey, focusKey),
      kind === 'expiry' && isMonthlyExpiry(focusKey) ? '月選擇權到期' : '',
      us ? `美股休市：${us}` : '',
      jp ? `日股休市：${jp}` : '',
    ].filter(Boolean).join(' · ');
  })();

  return <div
    ref={rootRef}
    className={`date-picker ${open ? 'is-open' : ''}`}
    onBlur={(event) => {
      const next = event.relatedTarget as Node | null;
      if (open && next && !event.currentTarget.contains(next)) setOpen(false);
    }}
  >
    <label>
      <span className="field-label-row"><span>{label}</span>{badge && <small className={badge.warning ? 'is-warning' : ''}>{badge.text}</small>}</span>
      <span className="date-picker-control">
        <input required={required} type="date" value={value} onChange={(event) => onChange(event.target.value)} />
        <button
          ref={triggerRef}
          type="button"
          className="date-picker-trigger"
          aria-label={`選擇${label}`}
          title={`選擇${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? close(false) : openPicker())}
        ><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2.5" /><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" /><circle cx="10" cy="12.4" r="1.3" /></svg></button>
      </span>
    </label>
    {open && <div
      ref={popoverRef}
      className={`date-picker-popover ${alignRight ? 'align-right' : ''}`}
      role="dialog"
      aria-label={`選擇${label}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }}
    >
      <div className="date-picker-head">
        <button type="button" className="date-picker-nav" aria-label="上個月" onClick={() => setFocusKey(shiftMonths(focusKey, -1))}>‹</button>
        <strong id={titleId} aria-live="polite">{`${focusDate.year}年${focusDate.month}月`}</strong>
        <button type="button" className="date-picker-nav" aria-label="下個月" onClick={() => setFocusKey(shiftMonths(focusKey, 1))}>›</button>
      </div>
      {chips.length > 0 && <div className="date-picker-chips" role="group" aria-label={kind === 'expiry' ? '快速選擇到期日' : '快速選擇日期'}>
        {chips.map((chip) => <button type="button" key={`${chip.label}-${chip.key}`} className={chip.key === value ? 'active' : ''} title={chip.title} disabled={disabled(chip.key)} onClick={() => select(chip.key)}>{chip.label}{chip.hint && <small>{chip.hint}</small>}</button>)}
      </div>}
      <div className="date-picker-grid" role="grid" aria-labelledby={titleId} onKeyDown={onGridKeyDown}>
        <div className="date-picker-row" role="row">{weekdayLabels.map((day, index) => <span key={day} className={`date-picker-weekday ${index === 0 || index === 6 ? 'is-weekend' : ''}`} role="columnheader">{day}</span>)}</div>
        {weeks.map((week) => <div className="date-picker-row" role="row" key={week[0]}>{week.map((key) => {
          const date = parseDateKey(key)!;
          const us = usHolidayName(key);
          const jp = japanHolidayName(key);
          const dayOfWeek = weekday(date);
          const monthly = kind === 'expiry' && isMonthlyExpiry(key);
          const blocked = disabled(key);
          const classes = [
            'date-picker-day',
            date.month !== focusDate.month ? 'is-outside' : '',
            dayOfWeek === 0 || dayOfWeek === 6 ? 'is-weekend' : '',
            us ? 'is-us-holiday' : '',
            jp ? 'is-jp-holiday' : '',
            kind === 'expiry' && dayOfWeek === 5 ? 'is-friday' : '',
            monthly ? 'is-monthly' : '',
            key === todayKey ? 'is-today' : '',
            key === value ? 'is-selected' : '',
          ].filter(Boolean).join(' ');
          const notes = [key === todayKey ? '今天' : '', monthly ? '月選擇權到期' : '', us ? `美股休市：${us}` : '', jp ? `日股休市：${jp}` : ''].filter(Boolean).join('，');
          return <span role="gridcell" key={key} aria-selected={key === value}>
            <button
              type="button"
              className={classes}
              data-day={key}
              tabIndex={key === focusKey ? 0 : -1}
              aria-label={`${date.year}年${date.month}月${date.day}日 週${weekdayLabels[dayOfWeek]}${notes ? `，${notes}` : ''}`}
              aria-current={key === todayKey ? 'date' : undefined}
              aria-disabled={blocked || undefined}
              title={notes || undefined}
              onFocus={() => { if (key !== focusKey) setFocusKey(key); }}
              onClick={() => select(key)}
            >{date.day}</button>
          </span>;
        })}</div>)}
      </div>
      <p className="date-picker-info" aria-live="polite">{focusInfo}</p>
      <div className="date-picker-foot">
        <span className="date-picker-legend"><i className="us" />美股休市<i className="jp" />日股休市{kind === 'expiry' && <><i className="monthly" />月選</>}</span>
        {!required && value && <button type="button" onClick={() => select('')}>清除</button>}
      </div>
    </div>}
  </div>;
}
