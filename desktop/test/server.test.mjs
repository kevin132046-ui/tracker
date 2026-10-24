// Runs the built site (../dist) the way the desktop app does, with a throwaway data folder.
// Needs `npm run build` at the repo root first.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { pickPort, seedDefaultBackground, startServer } from '../server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '..', '..', 'dist');
const backgroundJpeg = path.resolve(here, '..', 'resources', 'default-background.jpg');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optionflow-desktop-test-'));
const port = 48620;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('the site, its data routes and the bundled background work, and the data survives a restart', async () => {
  let server = await startServer({ siteDir, dataDir, port });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await fetch(`${server.url}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /OptionFlow/);
    const logo = await fetch(`${server.url}/optionflow-logo.png`);
    assert.equal(logo.status, 200, 'static files are served');

    const { trades } = await (await fetch(`${server.url}/api/trades`)).json();
    assert.ok(trades.length > 0, 'a new install shows the sample trades');

    assert.equal(await seedDefaultBackground(server, backgroundJpeg), true);
    assert.equal(await seedDefaultBackground(server, backgroundJpeg), false, 'only once');

    const saved = await fetch(`${server.url}/api/cash-flows`, {
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
    const { flows } = await (await fetch(`${server.url}/api/cash-flows`)).json();
    assert.equal(flows.length, 1, 'the deposit is still there after a restart');
    const background = await (await fetch(`${server.url}/api/background`)).json();
    assert.equal(background.exists, true);
    const image = await fetch(`${server.url}${background.imageUrl}`);
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
  } finally {
    await server.dispose();
  }
});

test('other sites cannot read or change the data through the local server', async () => {
  const server = await startServer({ siteDir, dataDir, port });
  try {
    // A web page that points its own name at 127.0.0.1 (DNS rebinding) arrives with its own Host.
    const rebound = await server.fetch('http://evil.example/api/trades');
    assert.equal(rebound.status, 503);
    // A form or fetch from another site is refused before it reaches the data.
    const crossSite = await fetch(`${server.url}/api/cash-flows`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(crossSite.status, 403);
  } finally {
    await server.dispose();
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
