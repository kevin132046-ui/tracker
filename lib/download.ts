/** Saves text as a file through an object URL (CSV backups and exports). */
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  downloadBlob(name, new Blob([text], { type }));
}

/** Saves a file the page made (the full backup ZIP, CSV exports). */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Large files take a moment to hand over; the URL stays valid long enough for the save to start.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Today's date on this device, YYYY-MM-DD (for file names). */
export const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
