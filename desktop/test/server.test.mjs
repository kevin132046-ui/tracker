// Runs the built site (../dist) the way the desktop app does, with a throwaway data folder.
// Needs `npm run build` at the repo root first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { keyHeader, pickPort, seedDefaultBackground, startServer } from '../server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '..', '..', 'dist');
const backgroundJpeg = path.resolve(here, '..', 'resources', 'default-background.jpg');
// A folder name with Chinese characters and a space, like many Windows user folders.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optionflow 測試-'));
const port = 48620;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('the site, its data routes and the bundled background work, and the data survives a restart', async () => {
  let server = await startServer({ siteDir, dataDir, port });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await server.fetch('/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /OptionFlow/);
    const logo = await server.fetch('/optionflow-logo.png');
    assert.equal(logo.status, 200, 'static files are served');

    const { trades } = await (await server.fetch('/api/trades')).json();
    assert.ok(trades.length > 0, 'a new install shows the sample trades');

    assert.equal(await seedDefaultBackground(server, backgroundJpeg), true);
    assert.equal(await seedDefaultBackground(server, backgroundJpeg), false, 'only once');

    const saved = await server.fetch('/api/cash-flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-10-01', kind: 'deposit', amount: 1000, note: 'test deposit' }),
    });
    assert.ok(saved.ok, `deposit saved (HTTP ${saved.status})`);
  } finally {
    await server.dispose();
  }

  server = await startServer({ siteDir, dataDir, port });
  try {
    const { flows } = await (await server.fetch('/api/cash-flows')).json();
    assert.equal(flows.length, 1, 'the deposit is still there after a restart');
    const background = await (await server.fetch('/api/background')).json();
    assert.equal(background.exists, true);
    const image = await server.fetch(background.imageUrl);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
  } finally {
    await server.dispose();
  }
});

test('only the app (with its launch key) is answered; other programs and sites are refused', async () => {
  const server = await startServer({ siteDir, dataDir, port });
  try {
    // Another program, browser or user on this computer: no key, nothing at all, not even the page.
    for (const pathname of ['/', '/api/trades', '/api/backup', '/optionflow-logo.png']) {
      assert.equal((await fetch(`${server.url}${pathname}`)).status, 403, pathname);
    }
    assert.equal((await fetch(`${server.url}/api/trades`, { headers: { [keyHeader]: 'guess' } })).status, 403, 'a wrong key');
    // With the key, the site's own checks still hold: a page that points its name at 127.0.0.1
    // (DNS rebinding) arrives with its own Host, and another site's write is refused.
    assert.equal((await server.fetch('http://evil.example/api/trades')).status, 503);
    const crossSite = await server.fetch('/api/cash-flows', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(crossSite.status, 403);
  } finally {
    await server.dispose();
  }
});

test('a workerd left running by a crashed app is stopped on the next launch, and the port is kept', async () => {
  const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optionflow-crash-'));
  const crashPort = 48660;
  try {
    // An app that starts its server, notes its workerd, then dies without stopping it.
    const script = `
      import { startServer } from ${JSON.stringify(new URL('../server.mjs', import.meta.url).href)};
      import fs from 'node:fs';
      const server = await startServer({ siteDir: ${JSON.stringify(siteDir)}, dataDir: ${JSON.stringify(crashDir)}, port: ${crashPort} });
      const lock = ${JSON.stringify(path.join(crashDir, 'server.json'))};
      for (let i = 0; i < 200; i += 1) { try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).workerdPid) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
      console.log(JSON.stringify({ port: server.port, lock: JSON.parse(fs.readFileSync(lock, 'utf8')) }));
      process.kill(process.pid, 'SIGKILL');
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    await new Promise((resolve) => child.on('exit', resolve));
    const crashed = JSON.parse(out.trim().split('\n').pop());
    assert.equal(crashed.port, crashPort);
    assert.ok(crashed.lock.workerdPid, 'the app noted its workerd');
    // On Linux and macOS workerd outlives the app; Windows ends it with the app (libuv's job object).
    const leftover = await new Promise((resolve) => { const socket = net.connect(crashPort, '127.0.0.1', () => { socket.end(); resolve(true); }); socket.on('error', () => resolve(false)); });
    if (process.platform !== 'win32') assert.equal(leftover, true, 'the crashed app left workerd running');

    const server = await startServer({ siteDir, dataDir: crashDir, port: crashPort });
    try {
      assert.equal(server.port, crashPort, 'the next launch gets its own port back');
      // Gone, or (in a container whose init does not reap) a zombie that no longer runs.
      const stillRunning = (() => {
        try { process.kill(crashed.lock.workerdPid, 0); } catch { return false; }
        try { return !/\)\s+Z\s/.test(fs.readFileSync(`/proc/${crashed.lock.workerdPid}/stat`, 'utf8')); } catch { return true; }
      })();
      assert.equal(stillRunning, false, 'the leftover is gone');
    } finally {
      await server.dispose();
    }
  } finally {
    fs.rmSync(crashDir, { recursive: true, force: true });
  }
});

test('a busy port moves the server to the next free one', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(port + 5, '127.0.0.1', resolve));
  try {
    assert.equal(await pickPort(port + 5), port + 6);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
