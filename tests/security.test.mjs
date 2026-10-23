import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { crossSiteWrite } from '@/lib/server/same-origin';
import { dataGate } from '@/lib/server/data-gate';

const site = 'https://tracker.example.workers.dev';
const request = (method, headers = {}, url = `${site}/api/trades/batch`) => new Request(url, { method, headers });
const reset = () => { for (const key of Object.keys(env)) delete env[key]; };

test('reads are never treated as cross-site writes', () => {
  assert.equal(crossSiteWrite(request('GET', { 'Sec-Fetch-Site': 'cross-site' })), null);
  assert.equal(crossSiteWrite(request('HEAD', { Origin: 'https://evil.example' })), null);
});

test('writes from the site itself pass', () => {
  assert.equal(crossSiteWrite(request('POST', { 'Sec-Fetch-Site': 'same-origin', Origin: site })), null);
  assert.equal(crossSiteWrite(request('DELETE', { 'Sec-Fetch-Site': 'same-origin' })), null);
  // Older browsers without Sec-Fetch-Site still send Origin.
  assert.equal(crossSiteWrite(request('PUT', { Origin: site })), null);
  // Not a browser at all (curl, scripts): there is no signed-in session to borrow.
  assert.equal(crossSiteWrite(request('POST')), null);
});

test('writes another site sends are refused', async () => {
  for (const headers of [
    { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' },
    // Another worker of the same account is same-site, but not this origin.
    { 'Sec-Fetch-Site': 'same-site', Origin: 'https://other.example.workers.dev' },
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
  ]) {
    const response = crossSiteWrite(request('POST', headers));
    assert.ok(response, JSON.stringify(headers));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'cross-site');
  }
});

test('the data gate refuses cross-site writes even when data is opened on purpose', async () => {
  reset();
  env.DATA_ACCESS = 'open';
  const response = await dataGate(request('POST', { 'Sec-Fetch-Site': 'cross-site' }));
  assert.equal(response?.status, 403);
  assert.equal(await dataGate(request('POST', { 'Sec-Fetch-Site': 'same-origin' })), null);
});

test('without Access configured the data stays closed except on localhost', async () => {
  reset();
  const remote = await dataGate(request('GET'));
  assert.equal(remote?.status, 503);
  assert.equal((await remote.json()).code, 'access-not-configured');
  assert.equal(await dataGate(request('GET', {}, 'http://localhost:3000/api/trades')), null);
  assert.equal(await dataGate(request('GET', {}, 'http://127.0.0.1:8787/api/trades')), null);
});

test('with Access configured a request without a token is turned away', async () => {
  reset();
  env.ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
  env.ACCESS_AUD = 'a'.repeat(64);
  const response = await dataGate(request('GET'));
  assert.equal(response?.status, 401);
  assert.equal((await response.json()).code, 'access-required');
  reset();
});
