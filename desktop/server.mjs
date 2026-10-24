// Runs the same build as the Cloudflare site (dist/server + dist/client) on this computer, in workerd
// (Cloudflare's own runtime) through Miniflare. D1 becomes a SQLite file and R2 a folder under dataDir.
// Plain Node, no Electron: main.mjs starts it for the window, and the tests start it on their own.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { Miniflare, Log, LogLevel } from 'miniflare';

export const defaultPort = 47820;
export const keyHeader = 'X-OptionFlow-Key';
const host = '127.0.0.1';
const run = promisify(execFile);

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

// ---------- A workerd left behind ----------
// workerd does not stop when the app is killed or crashes, and it keeps serving the data and holding
// the port and the database. The app notes which workerd it started (server.json in the data folder);
// the next launch stops that one if the app that started it is gone.

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
};

/** Running workerd processes: pid, parent pid and command line. */
async function workerdProcesses() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='workerd.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15_000 });
      const rows = stdout.trim() ? JSON.parse(stdout) : [];
      return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ pid: row.ProcessId, ppid: row.ParentProcessId, cmd: String(row.CommandLine ?? '') }));
    }
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,args='], { timeout: 15_000 });
    return stdout.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
      .map(([, pid, ppid, cmd]) => ({ pid: Number(pid), ppid: Number(ppid), cmd })).filter((row) => /workerd/.test(row.cmd));
  } catch {
    return [];
  }
}

const servesPort = (cmd, port) => new RegExp(`entry=${host.replace(/\./g, '\\.')}:${port}(\\s|$)`).test(cmd);

const lockFile = (dataDir) => path.join(dataDir, 'server.json');

async function stopLeftover(dataDir) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(lockFile(dataDir), 'utf8')); } catch { return; }
  if (lock.appPid !== process.pid && alive(lock.appPid)) return; // its app is still running
  if (alive(lock.workerdPid)) {
    // Only a workerd serving that port: never another program that happens to reuse the pid.
    const match = (await workerdProcesses()).find((row) => row.pid === lock.workerdPid && servesPort(row.cmd, lock.port));
    if (match) {
      try { process.kill(match.pid, 'SIGKILL'); } catch { /* already gone */ }
      for (let i = 0; i < 30 && !(await portFree(lock.port)); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try { fs.rmSync(lockFile(dataDir)); } catch { /* fine */ }
}

async function noteOwnWorkerd(dataDir, port) {
  const own = (await workerdProcesses()).find((row) => row.ppid === process.pid && servesPort(row.cmd, port));
  try { fs.writeFileSync(lockFile(dataDir), JSON.stringify({ appPid: process.pid, workerdPid: own?.pid ?? null, port })); } catch { /* best effort */ }
}

// ---------- Only the app's own window ----------
// The server listens on 127.0.0.1, which every program and every user on this computer can reach.
// A small gate worker in front of the site answers only requests carrying this launch's random key;
// the app adds it to its own window's requests (main.mjs). The key never leaves the app.
const gateScript = `export default {
  async fetch(request, env) {
    if (request.headers.get('${keyHeader.toLowerCase()}') !== env.KEY) {
      return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const headers = new Headers(request.headers);
    headers.delete('${keyHeader.toLowerCase()}');
    return env.SITE.fetch(new Request(request, { headers }));
  },
};`;

/**
 * Starts the site. siteDir holds server/ and client/ (the repo's dist folder); dataDir keeps the database
 * and uploaded files between launches. Resolves once it answers requests.
 */
export async function startServer({ siteDir, dataDir, port = defaultPort, logFile } = {}) {
  const serverDir = path.join(siteDir, 'server');
  const clientDir = path.join(siteDir, 'client');
  const config = JSON.parse(fs.readFileSync(path.join(serverDir, 'wrangler.json'), 'utf8'));
  fs.mkdirSync(dataDir, { recursive: true });
  await stopLeftover(dataDir);
  const chosen = await pickPort(port);
  const key = randomBytes(32).toString('hex');
  const compatibility = { compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags ?? [] };

  const mf = new Miniflare({
    host,
    port: chosen,
    defaultPersistRoot: path.join(dataDir, 'state'),
    log: logFile ? new FileLog(logFile) : new Log(LogLevel.WARN),
    workers: [
      { name: 'gate', modules: true, script: gateScript, bindings: { KEY: key }, serviceBindings: { SITE: 'site' }, ...compatibility },
      {
        name: 'site',
        rootPath: serverDir,
        modulesRoot: serverDir,
        modules: workerModules(serverDir),
        ...compatibility,
        // Static files first, the Worker for everything else (as on Cloudflare).
        assets: { directory: clientDir, routerConfig: { has_user_worker: true } },
        d1Databases: { DB: 'optionflow' },
        r2Buckets: { BACKGROUND_IMAGES: 'optionflow-files' },
      },
    ],
  });
  const url = await mf.ready;
  void noteOwnWorkerd(dataDir, chosen);
  const withKey = (init = {}) => ({ ...init, headers: { ...Object.fromEntries(new Headers(init.headers ?? {})), [keyHeader]: key } });
  return {
    mf,
    port: chosen,
    url: `http://${host}:${chosen}`,
    key,
    /** A request to the site as the app's window makes it (with the key). */
    fetch: (pathname, init) => mf.dispatchFetch(new URL(pathname, url), withKey(init)),
    dispose: async () => {
      await mf.dispose();
      try { fs.rmSync(lockFile(dataDir)); } catch { /* fine */ }
    },
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
