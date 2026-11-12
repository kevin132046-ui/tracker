'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef, useState } from 'react';

/** A selection as fractions of the picture (0–1), so it survives the preview being resized. */
type Box = { x: number; y: number; w: number; h: number };

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/** The selected part of a data: URL image, cut in the browser; PNG keeps screenshot text sharp. */
export async function cropImage(dataUrl: string, box: Box, maxBytes: number): Promise<string> {
  const picture = new Image();
  picture.src = dataUrl;
  await picture.decode();
  const sx = Math.round(box.x * picture.naturalWidth);
  const sy = Math.round(box.y * picture.naturalHeight);
  const width = Math.max(1, Math.round(box.w * picture.naturalWidth));
  const height = Math.max(1, Math.round(box.h * picture.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('這個瀏覽器無法裁切圖片。');
  context.drawImage(picture, sx, sy, width, height, 0, 0, width, height);
  const png = canvas.toDataURL('image/png');
  // A base64 data: URL is about 4/3 of the bytes; a large photo-like crop falls back to JPEG.
  return png.length * 0.75 <= maxBytes ? png : canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Drag a box over a screenshot to keep only the trades, so account numbers, balances and other rows
 * are cut off before anything is sent. Nothing leaves the browser here.
 */
export default function ImageCrop({ src, disabled, cropped, onCrop, onRestore }: {
  src: string;
  disabled: boolean;
  /** The picture shown is already a crop (offer to go back to the original). */
  cropped: boolean;
  onCrop: (box: Box) => void;
  onRestore: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const point = (event: ReactPointerEvent) => {
    const rect = frame.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event);
    setBox(null);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) setBox(boxOf(start.current, point(event)));
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = boxOf(start.current, point(event));
    start.current = null;
    // A click (or a sliver) is not a selection.
    setBox(next.w > 0.02 && next.h > 0.02 ? next : null);
  };

  return <div className="image-crop">
    <div ref={frame} className={`image-crop-frame${disabled ? ' is-disabled' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL preview, nothing to optimise */}
      <img src={src} alt="要送給 AI 的截圖" draggable={false} />
      {box && <span className="image-crop-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
    </div>
    <div className="image-crop-actions">
      <span>{box ? '框好了，按「裁切」只留下框內。' : '在圖上拖曳，框出要讀的交易；帳號、餘額等其他部分裁掉就不會送出。'}</span>
      {box && <button type="button" disabled={disabled} onClick={() => { onCrop(box); setBox(null); }}>裁切</button>}
      {box && <button type="button" disabled={disabled} onClick={() => setBox(null)}>取消框選</button>}
      {!box && cropped && <button type="button" disabled={disabled} onClick={onRestore}>還原原圖</button>}
    </div>
  </div>;
}
