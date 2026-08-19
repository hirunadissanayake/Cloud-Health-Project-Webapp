import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHandler } from '../server.mjs';

let upstream;
let frontend;
let baseUrl;

before(async () => {
  upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ path: request.url, method: request.method, body: Buffer.concat(chunks).toString() }));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  frontend = createServer(createRequestHandler({ gatewayUrl: upstreamUrl })).listen(0, '127.0.0.1');
  await once(frontend, 'listening');
  baseUrl = `http://127.0.0.1:${frontend.address().port}`;
});

after(async () => {
  await Promise.all([
    new Promise(resolve => frontend.close(resolve)),
    new Promise(resolve => upstream.close(resolve))
  ]);
});

test('serves the portal with security headers', async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await response.text(), /Cloud Health/);
});

test('provides a Cloud Run health endpoint', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.deepEqual(await response.json(), { status: 'UP' });
});

test('proxies API paths and query strings to the gateway', async () => {
  const response = await fetch(`${baseUrl}/api/patients?page=2`);
  assert.deepEqual(await response.json(), { path: '/api/patients?page=2', method: 'GET', body: '' });
});

test('preserves JSON request bodies through the gateway proxy', async () => {
  const response = await fetch(`${baseUrl}/api/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Lab result' })
  });
  assert.deepEqual(await response.json(), {
    path: '/api/records',
    method: 'POST',
    body: '{"title":"Lab result"}'
  });
});
