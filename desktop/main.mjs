// OptionFlow desktop: one window onto the site, served from this computer (server.mjs).
import { app, BrowserWindow, Menu, dialog, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultPort, keyHeader, seedDefaultBackground, startServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const smokeArg = process.argv.find((arg) => arg.startsWith('--smoke-test'));
const smokeTest = smokeArg !== undefined;
const smokeShot = smokeArg?.includes('=') ? smokeArg.slice(smokeArg.indexOf('=') + 1) : '';

app.setName('OptionFlow');
// The smoke test keeps its data apart from a real install on the same machine.
if (smokeTest) app.setPath('userData', path.join(app.getPath('temp'), `optionflow-smoke-${process.pid}`));

// Packaged: the site and the background sit in resources/; from the repo: ../dist and ./resources.
const siteDir = app.isPackaged ? path.join(process.resourcesPath, 'site') : path.resolve(here, '..', 'dist');
const backgroundJpeg = app.isPackaged ? path.join(process.resourcesPath, 'default-background.jpg') : path.join(here, 'resources', 'default-background.jpg');
const dataDir = path.join(app.getPath('userData'), 'data');
const logDir = path.join(app.getPath('userData'), 'logs');
const settingsFile = path.join(app.getPath('userData'), 'desktop.json');

/** The workerd binary lives inside app.asar's unpacked twin once packaged; spawn cannot read from the archive. */
function pointMiniflareAtWorkerd() {
  if (process.env.MINIFLARE_WORKERD_PATH) return;
  try {
    const binary = require('workerd').default ?? require('workerd');
    if (typeof binary === 'string') process.env.MINIFLARE_WORKERD_PATH = binary.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  } catch { /* Miniflare finds it itself */ }
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...patch }, null, 2));
  } catch { /* settings are a convenience */ }
}

let server = null;
let window = null;

function buildMenu() {
  const template = [
    {
      label: '檔案',
      submenu: [
        { label: '開啟資料資料夾', click: () => shell.openPath(dataDir) },
        { label: '開啟記錄檔資料夾', click: () => shell.openPath(logDir) },
        { type: 'separator' },
        { label: '結束', role: 'quit' },
      ],
    },
    {
      label: '檢視',
      submenu: [
        { label: '重新載入', role: 'reload' },
        { label: '實際大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '縮小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全螢幕', role: 'togglefullscreen' },
        { label: '開發者工具', role: 'toggleDevTools' },
      ],
    },
    {
      label: '說明',
      submenu: [
        { label: 'GitHub 專案頁', click: () => shell.openExternal('https://github.com/kevin132046-ui/tracker') },
        { label: `關於 OptionFlow ${app.getVersion()}`, click: () => dialog.showMessageBox({ type: 'info', title: 'OptionFlow', message: `OptionFlow 桌面版 ${app.getVersion()}`, detail: `資料存在：\n${dataDir}\n\n程式碼以 MIT License 釋出。` }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Only the local site opens inside the window; every other link goes to the system browser. */
function keepLinksOutside(contents, origin) {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const isLocal = (url) => { try { return new URL(url).origin === origin; } catch { return false; } };
  const openOutside = (url) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); };
  contents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url)) openOutside(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isLocal(url)) return;
    event.preventDefault();
    openOutside(url);
  });
}

function lockDownSession(origin, key) {
  // The local server answers only requests with this launch's key (server.mjs); only this window has it.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith(`${origin}/`)) details.requestHeaders[keyHeader] = key;
    callback({ requestHeaders: details.requestHeaders });
  });
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed.has(permission) && (details.requestingUrl ?? '').startsWith(`${origin}/`));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => allowed.has(permission) && requestingOrigin === origin);
  // Backups and CSV exports: ask where to save, starting in Downloads.
  session.defaultSession.on('will-download', (event, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
}

function createWindow(url) {
  const saved = readSettings().bounds;
  window = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 380,
    minHeight: 560,
    title: 'OptionFlow',
    backgroundColor: '#0c0d11',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(here, 'resources', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (readSettings().maximized) window.maximize();
  keepLinksOutside(window.webContents, url);
  // Windows and Linux draw real scrollbars; when a font is a pixel wider than on the site (the vertical
  // 桔梗 title), the page would grow a horizontal one. Nothing on the page is meant to scroll sideways.
  window.webContents.on('dom-ready', () => { void window?.webContents.insertCSS('html { overflow-x: clip; }'); });
  window.once('ready-to-show', () => window.show());
  window.on('close', () => {
    if (!window.isMaximized() && !window.isFullScreen()) writeSettings({ bounds: window.getBounds() });
    writeSettings({ maximized: window.isMaximized() });
  });
  window.on('closed', () => { window = null; });
  void window.loadURL(url);
  return window;
}

async function start() {
  fs.mkdirSync(logDir, { recursive: true });
  pointMiniflareAtWorkerd();
  const settings = readSettings();
  server = await startServer({ siteDir, dataDir, port: settings.port ?? defaultPort, logFile: path.join(logDir, 'server.log') });
  if (settings.port !== server.port) writeSettings({ port: server.port });
  if (!settings.backgroundSeeded) {
    try {
      await seedDefaultBackground(server, backgroundJpeg);
      writeSettings({ backgroundSeeded: true });
    } catch (error) {
      fs.appendFileSync(path.join(logDir, 'server.log'), `${new Date().toISOString()} default background: ${error}\n`);
    }
  }
  lockDownSession(server.url, server.key);
  buildMenu();
  const win = createWindow(server.url);
  if (smokeTest) await runSmokeTest(win);
}

/**
 * --smoke-test[=shot.png]: open the page, check the data routes answer, optionally save a screenshot,
 * and quit with 0 (or 1 on any failure). Used by CI on every platform the release is built for.
 */
async function runSmokeTest(win) {
  // Stop workerd before exiting, so nothing is left running for CI to wait on.
  const fail = (message) => {
    console.error(`SMOKE FAIL ${message}`);
    const closing = server;
    server = null;
    Promise.resolve(closing?.dispose()).catch(() => undefined).finally(() => app.exit(1));
  };
  const timer = setTimeout(() => fail('timed out'), 90_000);
  try {
    await new Promise((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (event, code, description) => reject(new Error(`${code} ${description}`)));
    });
    const result = await win.webContents.executeJavaScript(`(async () => {
      const trades = await fetch('/api/trades').then((r) => r.json());
      const background = await fetch('/api/background').then((r) => r.json());
      return { title: document.title, trades: Array.isArray(trades.trades) ? trades.trades.length : -1, background: background.exists === true };
    })()`);
    console.log(`SMOKE ${JSON.stringify(result)}`);
    if (!/OptionFlow/.test(result.title) || result.trades < 1 || !result.background) throw new Error(JSON.stringify(result));
    if (smokeShot) {
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      fs.writeFileSync(smokeShot, (await win.webContents.capturePage()).toPNG());
    }
    clearTimeout(timer);
    console.log('SMOKE OK');
    await server?.dispose();
    server = null;
    app.exit(0);
  } catch (error) {
    clearTimeout(timer);
    fail(error instanceof Error ? error.message : String(error));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('OptionFlow 無法啟動', `${error instanceof Error ? error.message : error}\n\n記錄檔：${logDir}`);
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
  // Stop the local server before the app goes, so workerd does not linger.
  app.on('will-quit', (event) => {
    if (!server) return;
    event.preventDefault();
    const closing = server;
    server = null;
    closing.dispose().catch(() => undefined).finally(() => app.quit());
  });
}
