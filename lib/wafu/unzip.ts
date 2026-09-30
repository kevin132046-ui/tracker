/**
 * Reads the files out of a .zip in the browser (stored or deflated entries), using the built-in
 * DecompressionStream, so 「一次上傳全部」 can take the 和風素材 zip as it is.
 * Folders, macOS resource forks (__MACOSX/, ._name) and hidden files are skipped.
 */
export const maxZipBytes = 80 * 1024 * 1024;
const maxEntryBytes = 60 * 1024 * 1024;

const mimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm',
};

export const isZipFile = (file: File) => /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

/**
 * Entry names: UTF-8 when the zip says so (flag bit 11) or carries an Info-ZIP Unicode path;
 * otherwise try UTF-8, then Big5 (Traditional Chinese Windows), Shift_JIS and GBK.
 */
function decodeName(bytes: Uint8Array, utf8Flag: boolean, unicodePath: Uint8Array | null) {
  if (unicodePath) return new TextDecoder('utf-8').decode(unicodePath);
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  for (const encoding of ['utf-8', 'big5', 'shift_jis', 'gbk']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch { /* try the next encoding */ }
  }
  return new TextDecoder('latin1').decode(bytes);
}

/** Info-ZIP Unicode Path extra field (0x7075): version, CRC of the raw name, then the UTF-8 name. */
function unicodePathOf(extra: Uint8Array) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let at = 0; at + 4 <= extra.length;) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === 0x7075 && size > 5) return extra.slice(at + 9, at + 4 + size);
    at += 4 + size;
  }
  return null;
}

async function inflate(data: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(file: Blob): Promise<File[]> {
  if (file.size > maxZipBytes) throw new Error(`壓縮檔超過 ${maxZipBytes / 1024 / 1024} MB。`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  // End of central directory: the last 22+ bytes (a comment of up to 64 KB may follow it).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('這不是可讀的 zip 壓縮檔。');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('不支援 ZIP64 壓縮檔，請改用一般 zip。');

  const files: File[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip 壓縮檔內容損壞。');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const rawName = bytes.slice(at + 46, at + 46 + nameLength);
    const extra = bytes.slice(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    at += 46 + nameLength + extraLength + commentLength;

    const path = decodeName(rawName, (flags & 0x800) !== 0, unicodePathOf(extra)).replace(/\\/g, '/');
    const name = path.split('/').pop() ?? '';
    if (!name || path.endsWith('/') || path.startsWith('__MACOSX/') || name.startsWith('.')) continue;
    if (flags & 0x1) throw new Error(`「${name}」有密碼保護，無法讀取。`);
    if (size > maxEntryBytes) throw new Error(`「${name}」解壓後超過 ${maxEntryBytes / 1024 / 1024} MB。`);

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);
    const content = method === 0 ? data.slice() : method === 8 ? await inflate(data) : null;
    if (!content) throw new Error(`「${name}」的壓縮方式不支援（請用一般 zip）。`);
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    files.push(new File([content], name, { type: mimeByExtension[extension] ?? 'application/octet-stream' }));
  }
  return files;
}
