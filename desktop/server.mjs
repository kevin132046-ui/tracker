// Runs the same build as the Cloudflare site (dist/server + dist/client) on this computer, in workerd
// (Cloudflare's own runtime) through Miniflare. D1 becomes a SQLite file and R2 a folder under dataDir.
// Plain Node, no Electron: main.mjs starts it for the window, and the tests start it on their own.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';

export const defaultPort = 47820;
const host = '127.0.0.1';

/** Every module of the built Worker: index.js first, then the chunks it imports. */
function workerModules(serverDir) {
  const entry = path.join(serverDir, 'index.js');
  if (!fs.existsSync(entry)) throw new Error(`找不到網站的建置檔（${entry}）。請先在 repo 根目錄執行 npm run build。`);
  const rest = fs.readdirSync(serverDir, { recursive: true })
    .map((file) => path.join(serverDir, String(file)))
    .filter((file) => /\.m?js$/.test(file) && file !== entry && fs.statSync(file).isFile());
  return [entry, ...rest].map((file) => ({ type: 'ESModule', path: file }));
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * The port to use: the one from last time when it is free, else the next free one. The page's own
 * settings (theme, tone, columns) live in browser storage, which belongs to one origin, port included,
 * so the port should stay the same from launch to launch.
 */
export async function pickPort(preferred = defaultPort) {
  for (let offset = 0; offset < 40; offset += 1) {
    const port = preferred + offset;
    if (await portFree(port)) return port;
  }
  throw new Error(`${preferred} 起的 40 個連接埠都被占用了。`);
}

class FileLog extends Log {
  constructor(file) {
    super(LogLevel.INFO);
    this.file = file;
  }
  log(message) {
    try { fs.appendFileSync(this.file, `${new Date().toISOString()} ${message}\n`); } catch { /* logging is best effort */ }
  }
}

/**
 * Starts the site. siteDir holds server/ and client/ (the repo's dist folder); dataDir keeps the database
 * and uploaded files between launches. Resolves once it answers requests.
 */
export async function startServer({ siteDir, dataDir, port = defaultPort, logFile } = {}) {
  const serverDir = path.join(siteDir, 'server');
  const clientDir = path.join(siteDir, 'client');
  const config = JSON.parse(fs.readFileSync(path.join(serverDir, 'wrangler.json'), 'utf8'));
  fs.mkdirSync(dataDir, { recursive: true });
  const chosen = await pickPort(port);

  const mf = new Miniflare({
    host,
    port: chosen,
    rootPath: serverDir,
    modulesRoot: serverDir,
    modules: workerModules(serverDir),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [],
    // Static files first, the Worker for everything else (as on Cloudflare).
    assets: { directory: clientDir, routerConfig: { has_user_worker: true } },
    d1Databases: { DB: 'optionflow' },
    r2Buckets: { BACKGROUND_IMAGES: 'optionflow-files' },
    defaultPersistRoot: path.join(dataDir, 'state'),
    log: logFile ? new FileLog(logFile) : new Log(LogLevel.WARN),
  });
  const url = await mf.ready;
  return {
    mf,
    port: chosen,
    url: `http://${host}:${chosen}`,
    fetch: (pathname, init) => mf.dispatchFetch(new URL(pathname, url), init),
    dispose: () => mf.dispose(),
  };
}

/**
 * A new install starts with the bundled cassette-futurism background. Only once: after that the
 * owner's own choice (another picture, 原始, or a restored backup) stands.
 */
export async function seedDefaultBackground(server, jpegPath) {
  const current = await server.fetch('/api/background', { headers: { Accept: 'application/json' } });
  if (!current.ok) throw new Error(`背景設定無法讀取（HTTP ${current.status}）`);
  if ((await current.json()).exists) return false;
  const bytes = fs.readFileSync(jpegPath);
  const saved = await server.fetch('/api/background?mode=image', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
  if (!saved.ok) throw new Error(`預設背景無法保存（HTTP ${saved.status}）`);
  return true;
}
