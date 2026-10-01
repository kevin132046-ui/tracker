/**
 * Reads the first rows of an Excel workbook (.xlsx) in the browser, with no library: the file is a
 * ZIP of XML parts, unpacked with DecompressionStream and read with DOMParser. Shared strings,
 * inline strings, numbers, booleans and dates (by the cell's number format, as YYYY-MM-DD) are
 * supported; formulas give their cached value. The old binary .xls format is not.
 */
export type XlsxSheet = { name: string; rows: string[][] };

const textDecoder = new TextDecoder();
const u16 = (view: DataView, at: number) => view.getUint16(at, true);
const u32 = (view: DataView, at: number) => view.getUint32(at, true);

async function inflate(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The ZIP's entries by name, unpacked on demand. */
function zipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 65_557); at--) {
    if (u32(view, at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('這不是有效的 Excel（.xlsx）檔案。');
  const count = u16(view, end + 10);
  let at = u32(view, end + 16);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  for (let i = 0; i < count && u32(view, at) === 0x02014b50; i++) {
    const method = u16(view, at + 10);
    const size = u32(view, at + 20);
    const nameLength = u16(view, at + 28), extraLength = u16(view, at + 30), commentLength = u16(view, at + 32);
    const local = u32(view, at + 42);
    const name = textDecoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, async () => {
      const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error('Excel 檔使用了不支援的壓縮方式。');
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const xml = (data: Uint8Array) => new DOMParser().parseFromString(textDecoder.decode(data), 'application/xml');
const all = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
const text = (node: Element) => all(node, 't').map((t) => t.textContent ?? '').join('');

// Built-in number formats that are dates (Excel's fixed ids).
const builtInDates = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const isDateCode = (code: string) => /[dmyｙ年月日]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^general$/i.test(code);

function serialDate(serial: number, date1904: boolean) {
  // 1900 system: day 1 = 1900-01-01, with Excel's phantom 29 Feb 1900 (serial 60) after it.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86_400_000);
  return Number.isNaN(date.getTime()) ? String(serial) : date.toISOString().slice(0, 10);
}

function columnIndex(ref: string) {
  let index = 0;
  for (const ch of ref.replace(/\d+$/, '')) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

const maxRows = 5_000, maxColumns = 60;

/** Every sheet's name; the rows are read only for the sheet asked for. */
export async function readXlsx(buffer: ArrayBuffer, sheetIndex = 0): Promise<{ sheets: string[]; sheet: XlsxSheet }> {
  const entries = zipEntries(buffer);
  const read = async (name: string) => { const entry = entries.get(name); return entry ? xml(await entry()) : null; };
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('這不是有效的 Excel（.xlsx）檔案。');
  const date1904 = all(workbook, 'workbookPr').some((node) => ['1', 'true'].includes(node.getAttribute('date1904') ?? ''));
  const sheetNodes = all(workbook, 'sheet');
  if (!sheetNodes.length) throw new Error('活頁簿裡沒有工作表。');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const targets = new Map(rels ? all(rels, 'Relationship').map((node) => [node.getAttribute('Id') ?? '', node.getAttribute('Target') ?? '']) : []);
  const chosen = sheetNodes[Math.min(sheetIndex, sheetNodes.length - 1)];
  const relId = chosen.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? chosen.getAttribute('r:id') ?? '';
  const target = (targets.get(relId) ?? `worksheets/sheet${sheetIndex + 1}.xml`).replace(/^\/?(xl\/)?/, '');
  const sheetXml = await read(`xl/${target}`);
  if (!sheetXml) throw new Error('讀不到這張工作表。');

  const shared = await read('xl/sharedStrings.xml');
  const strings = shared ? all(shared, 'si').map(text) : [];
  const styles = await read('xl/styles.xml');
  const customDates = new Set(styles ? all(styles, 'numFmt').filter((node) => isDateCode(node.getAttribute('formatCode') ?? '')).map((node) => Number(node.getAttribute('numFmtId'))) : []);
  const cellXfs = styles ? all(styles, 'cellXfs')[0] : undefined;
  const dateStyle = cellXfs ? Array.from(cellXfs.children).map((xf) => { const id = Number(xf.getAttribute('numFmtId') ?? 0); return builtInDates.has(id) || customDates.has(id); }) : [];

  const rows: string[][] = [];
  for (const row of all(sheetXml, 'row').slice(0, maxRows)) {
    const cells: string[] = [];
    for (const cell of all(row, 'c')) {
      const column = columnIndex(cell.getAttribute('r') ?? '');
      const at = column >= 0 ? column : cells.length;
      if (at >= maxColumns) continue;
      const type = cell.getAttribute('t');
      const raw = all(cell, 'v')[0]?.textContent ?? '';
      let value = raw;
      if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = text(cell);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if ((type === null || type === 'n') && raw !== '' && dateStyle[Number(cell.getAttribute('s') ?? 0)]) value = serialDate(Number(raw), date1904);
      while (cells.length < at) cells.push('');
      cells[at] = value.trim();
    }
    rows.push(cells);
  }
  // Drop empty rows at the top (titles sometimes sit a few rows down).
  while (rows.length && rows[0].every((cell) => !cell)) rows.shift();
  return { sheets: sheetNodes.map((node) => node.getAttribute('name') ?? ''), sheet: { name: chosen.getAttribute('name') ?? '', rows } };
}

/** Rows as CSV text (quoted where needed), for the importer's CSV path. */
export const rowsToCsv = (rows: readonly string[][]) => rows
  .filter((row) => row.some((cell) => cell))
  .map((row) => row.map((cell) => /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(','))
  .join('\n');
