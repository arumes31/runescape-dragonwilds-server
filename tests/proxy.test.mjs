import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createApp } from '../admin/server.mjs';

const password = 'a-long-proxy-test-password';
const trustedProxies = ['127.0.0.1/32', '::1/128'];

async function fixture(t, options = {}) {
  const app = createApp({ password, controller: {}, origins: ['http://localhost:8080'], ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  return (forwarded, suppliedPassword = 'wrong') => new Promise((resolve, reject) => {
    const headers = { Host: 'localhost:8080', Origin: 'http://localhost:8080',
      'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin' };
    if (forwarded !== undefined) headers['X-Forwarded-For'] = forwarded;
    const request = http.request({ hostname: '127.0.0.1', port: app.address().port,
      path: '/api/login', method: 'POST', headers }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ password: suppliedPassword }));
  });
}

async function exhaust(login, forwarded) {
  for (let attempt = 0; attempt < 10; attempt++) assert.equal(await login(forwarded), 401);
  assert.equal(await login(forwarded, password), 429);
}

test('trusted proxy clients have independent login attempt limits', async t => {
  const login = await fixture(t, { trustedProxies });
  await exhaust(login, '198.51.100.10');
  assert.equal(await login('198.51.100.11', password), 200);
  assert.equal(await login('198.51.100.10', password), 429);
});

test('untrusted direct peers cannot rotate forwarded addresses to bypass throttling', async t => {
  const login = await fixture(t);
  await exhaust(login, '198.51.100.10');
  assert.equal(await login('198.51.100.11', password), 429);
});

test('forwarded chains stop at the first untrusted hop from the right', async t => {
  const login = await fixture(t, { trustedProxies: [...trustedProxies, '10.0.0.0/8'] });
  await exhaust(login, '203.0.113.99, 198.51.100.10, 10.2.3.4');
  assert.equal(await login('203.0.113.100, 198.51.100.10, 10.2.3.4', password), 429);
  assert.equal(await login('203.0.113.99, 198.51.100.11, 10.2.3.4', password), 200);
});

test('IPv4 and IPv4-mapped IPv6 share one login attempt limit', async t => {
  const login = await fixture(t, { trustedProxies });
  await exhaust(login, '198.51.100.10');
  assert.equal(await login('::ffff:198.51.100.10', password), 429);
  assert.equal(await login('::ffff:198.51.100.11', password), 200);
});

test('equivalent IPv6 forms share one login attempt limit', async t => {
  const login = await fixture(t, { trustedProxies });
  await exhaust(login, '2001:db8::1');
  assert.equal(await login('2001:0DB8:0000:0000:0000:0000:0000:0001', password), 429);
  assert.equal(await login('2001:db8::2', password), 200);
});

test('malformed forwarding from a trusted proxy is rejected before authentication', async t => {
  const login = await fixture(t, { trustedProxies });
  for (const forwarded of ['unknown', '198.51.100.10:443', '198.51.100.10,,10.0.0.1',
    '[2001:db8::1]', '2001:db8::1%eth0', '198.51.100.10, invalid']) {
    assert.equal(await login(forwarded, password), 400, forwarded);
  }
  assert.equal(await login('198.51.100.10', password), 200);
});

test('untrusted malformed forwarding is ignored and cannot alter authentication', async t => {
  const login = await fixture(t);
  assert.equal(await login('not-an-address', password), 200);
});

test('missing forwarding falls back to the actual peer address', async t => {
  const login = await fixture(t, { trustedProxies });
  await exhaust(login, undefined);
  assert.equal(await login(undefined, password), 429);
});

test('invalid trusted proxy configuration fails app creation', () => {
  for (const trustedProxies of [['proxy.example'], ['10.0.0.1/33'], ['::1/129'], ['10.0.0.1/nope'], [''], ['0.0.0.0/0'], ['::/0']]) {
    assert.throws(() => createApp({ password, controller: {}, origins: ['http://localhost:8080'], trustedProxies }), undefined, JSON.stringify(trustedProxies));
  }
});

test('proxy CIDRs match canonical addresses and their exact network boundaries', async () => {
  const { trustedProxyMatcher, clientAddress } = await import('../admin/proxy.mjs');
  const trusted = trustedProxyMatcher(['10.2.3.0/24', '2001:db8:1::/48', '127.0.0.1/32']);
  for (const address of ['10.2.3.0', '10.2.3.255', '::ffff:10.2.3.4', '2001:db8:1::', '2001:db8:1:ffff:ffff:ffff:ffff:ffff']) assert.equal(trusted(address), true, address);
  for (const address of ['10.2.2.255', '10.2.4.0', '2001:db8:0:ffff:ffff:ffff:ffff:ffff', '2001:db8:2::']) assert.equal(trusted(address), false, address);
  const request = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.10, 10.2.3.4' } };
  assert.equal(clientAddress(request, trusted), '198.51.100.10');
});
