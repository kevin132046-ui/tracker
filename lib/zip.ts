/**
 * A small ZIP writer and reader for the full backup (lib/backup-client). Plain ZIP: every OS can open the
 * file. JSON is deflated with the browser's CompressionStream; images and music are already compressed
 * and are stored as they are. No ZIP64, so a backup stays under 4 GB and 65,535 files.
 */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

/**
 * Inflates at most `limit` bytes: a crafted file can claim a small size and expand to gigabytes,
 * so reading stops as soon as the output passes what the archive says it holds.
 */
async function inflateAtMost(packed: Uint8Array, limit: number, name: string) {
  const reader = new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`備份檔裡的「${name}」已損毀。`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export type ZipInput = { name: string; data: Uint8Array; compress?: boolean };

const maxZipBytes = 0xffffffff;
const encoder = new TextEncoder();

/** DOS time and date fields for a timestamp (local time, two-second resolution). */
function dosStamp(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** Builds a ZIP file from the entries, in order. */
export async function createZip(entries: ZipInput[], date = new Date()): Promise<Blob> {
  if (entries.length > 0xffff) throw new Error('備份裡的檔案太多（上限 65,535 個）。');
  const { time, day } = dosStamp(date);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const packed = entry.compress ? await transform(entry.data, new CompressionStream('deflate-raw')) : entry.data;
    // Deflating can make a small file bigger; then the plain bytes go in.
    const deflated = entry.compress === true && packed.length < entry.data.length;
    const body = deflated ? packed : entry.data;
    const method = deflated ? 8 : 0;
    if (offset + 30 + name.length + body.length > maxZipBytes) throw new Error('備份超過 4 GB，無法存成一個 ZIP。');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // file names are UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name as BlobPart, body as BlobPart);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, method, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, body.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize + 22 > maxZipBytes) throw new Error('備份超過 4 GB，無法存成一個 ZIP。');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: 'application/zip' });
}

export type ZipEntry = { name: string; size: number; read: () => Promise<Uint8Array> };

const notZip = () => new Error('這不是 OptionFlow 的備份檔（無法讀取 ZIP 內容）。');

/** Lists a ZIP file's entries; each one is read (and checked against its CRC) only when asked for. */
export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailSize = Math.min(file.size, 22 + 0xffff);
  const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { at = i; break; }
  }
  if (at < 0) throw notZip();
  const end = new DataView(tail.buffer, at);
  const count = end.getUint16(10, true);
  const centralSize = end.getUint32(12, true);
  const centralOffset = end.getUint32(16, true);
  if (centralOffset + centralSize > file.size) throw notZip();
  const central = new DataView(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let pos = 0;
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > central.byteLength || central.getUint32(pos, true) !== 0x02014b50) throw notZip();
    const flags = central.getUint16(pos + 8, true);
    const method = central.getUint16(pos + 10, true);
    const crc = central.getUint32(pos + 16, true);
    const packedSize = central.getUint32(pos + 20, true);
    const size = central.getUint32(pos + 24, true);
    const nameLength = central.getUint16(pos + 28, true);
    const extraLength = central.getUint16(pos + 30, true);
    const commentLength = central.getUint16(pos + 32, true);
    const localOffset = central.getUint32(pos + 42, true);
    const name = decoder.decode(new Uint8Array(central.buffer, central.byteOffset + pos + 46, nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('備份檔有密碼保護，無法讀取。');
    if (method !== 0 && method !== 8) throw new Error('備份檔用了不支援的壓縮方式，請用 OptionFlow 匯出的原始檔案。');
    entries.set(name, {
      name,
      size,
      read: async () => {
        const header = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
        if (header.getUint32(0, true) !== 0x04034b50) throw notZip();
        const start = localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const packed = new Uint8Array(await file.slice(start, start + packedSize).arrayBuffer());
        const bytes = method === 8 ? await inflateAtMost(packed, size, name) : packed;
        if (bytes.length !== size || crc32(bytes) !== crc) throw new Error(`備份檔裡的「${name}」已損毀。`);
        return bytes;
      },
    });
  }
  return entries;
}
