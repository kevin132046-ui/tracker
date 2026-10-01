/**
 * Turns a PDF statement into table text in the browser: pdf.js reads each page's text with its
 * position, pieces on the same baseline become a line, and wide gaps split a line into cells. The
 * result is tab-separated text for the importer's paste editor, where the user checks it before the
 * usual column mapping. Nothing leaves the browser. Scanned (image-only) PDFs have no text to read.
 */
export type PdfTable = { pages: number; lines: string[][] };

const maxPages = 60;
const leadingDate = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s+(\S.*)$/;

type Piece = { str: string; x: number; y: number; w: number; h: number };

export async function readPdfTable(buffer: ArrayBuffer): Promise<PdfTable> {
  const pdfjs = await import('pdfjs-dist');
  // pdf.js's worker code runs on the page (its "fake worker"): a statement is a few pages, and this
  // avoids depending on how the build serves a separate worker file.
  const globals = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
  globals.pdfjsWorker ??= await import('pdfjs-dist/build/pdf.worker.min.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  } catch (error) {
    throw new Error(error instanceof Error && /password/i.test(error.message) ? '這份 PDF 有密碼保護，請先移除密碼再匯入。' : '無法讀取這份 PDF。');
  }
  const lines: string[][] = [];
  const pages = Math.min(doc.numPages, maxPages);
  for (let number = 1; number <= pages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const pieces: Piece[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      pieces.push({ str: item.str.trim(), x: item.transform[4], y: item.transform[5], w: item.width, h: Math.abs(item.transform[3]) || item.height || 8 });
    }
    // Top of the page first; pieces within half a text height share a line.
    pieces.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Piece[][] = [];
    for (const piece of pieces) {
      const row = rows.at(-1);
      if (row && Math.abs(row[0].y - piece.y) <= Math.max(2, piece.h * 0.5)) row.push(piece);
      else rows.push([piece]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let end = -Infinity;
      for (const piece of row) {
        const charWidth = piece.w / Math.max(1, piece.str.length);
        // A gap wider than about two characters starts a new cell.
        if (cells.length && piece.x - end <= Math.max(3, charWidth * 1.8)) cells[cells.length - 1] += (piece.x - end > charWidth * 0.25 ? ' ' : '') + piece.str;
        else cells.push(piece.str);
        end = piece.x + piece.w;
      }
      // A date run together with the next column ("03/14/2026 MSFT") becomes two cells.
      lines.push(cells.map((cell) => cell.replace(/\s+/g, ' ').trim()).flatMap((cell) => {
        const joined = cell.match(leadingDate);
        return joined ? [joined[1], joined[2]] : [cell];
      }));
    }
    page.cleanup();
  }
  await doc.destroy();
  if (!lines.length) throw new Error('這份 PDF 沒有可讀的文字（可能是掃描影像），請改用 CSV／Excel 或 AI 截圖輸入。');
  return { pages: doc.numPages, lines };
}

const datePattern = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/;
const numberPattern = /[-(]?\$?\d[\d,]*(\.\d+)?\)?/;

/**
 * The lines that look like trades (a date, a number and at least three cells), with the nearest
 * heading line above the first of them, so the column mapping has names to work with.
 */
export function likelyTradeLines(lines: readonly string[][]) {
  const data = lines.map((cells, index) => ({ cells, index })).filter(({ cells }) => cells.length >= 3 && cells.some((cell) => datePattern.test(cell)) && cells.filter((cell) => numberPattern.test(cell)).length >= 2);
  if (!data.length) return [];
  const first = data[0].index;
  const width = Math.max(...data.slice(0, 10).map(({ cells }) => cells.length));
  let header: string[] | null = null;
  for (let index = first - 1; index >= Math.max(0, first - 6); index--) {
    const cells = lines[index];
    if (cells.length >= Math.min(3, width) && cells.filter((cell) => /[A-Za-z぀-ヿ一-鿿]/.test(cell) && !numberPattern.test(cell.replace(/[A-Za-z]/g, ''))).length >= cells.length * 0.6) { header = cells; break; }
  }
  const seen = new Set<string>();
  const rows = data.map(({ cells }) => cells).filter((cells) => {
    // Page headers repeat on every page; keep only the first copy of any identical line.
    const key = cells.join('\t');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return header ? [header, ...rows.filter((cells) => cells.join('\t') !== header!.join('\t'))] : rows;
}

export const linesToTsv = (lines: readonly string[][]) => lines.map((cells) => cells.map((cell) => cell.replace(/\t/g, ' ')).join('\t')).join('\n');
