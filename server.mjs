import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_BODY_LIMIT = 30 * 1024 * 1024;
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
]);

export function createRequestHandler({
  publicDirectory = join(moduleDirectory, 'public'),
  gatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:8080',
  bodyLimit = DEFAULT_BODY_LIMIT
} = {}) {
  const gateway = new URL(gatewayUrl);

  return async (request, response) => {
    try {
      const url = new URL(request.url, 'http://frontend.local');
      if (url.pathname === '/healthz') {
        return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ status: 'UP' }));
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return await proxyApi(request, response, url, gateway, bodyLimit);
      }
      return serveStatic(response, url.pathname, publicDirectory);
    } catch (error) {
      if (!response.headersSent) {
        send(response, error.statusCode || 502, 'application/problem+json; charset=utf-8', JSON.stringify({
          title: error.statusCode === 413 ? 'Request too large' : 'Gateway unavailable',
          status: error.statusCode || 502,
          detail: error.message
        }));
      } else {
        response.destroy(error);
      }
    }
  };
}

async function proxyApi(request, response, requestUrl, gateway, bodyLimit) {
  const target = new URL(requestUrl.pathname + requestUrl.search, gateway);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && !['host', 'connection', 'content-length'].includes(name.toLowerCase())) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  headers.set('x-forwarded-host', request.headers.host || '');
  headers.set('x-forwarded-proto', request.socket.encrypted ? 'https' : 'http');

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request, bodyLimit);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000)
  });

  response.statusCode = upstream.status;
  for (const [name, value] of upstream.headers) {
    if (!['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  }
  setSecurityHeaders(response);
  if (!upstream.body) {
    return response.end();
  }
  Readable.fromWeb(upstream.body).pipe(response);
}

async function readBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) {
      const error = new Error(`Request exceeds the ${limit}-byte frontend limit`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function serveStatic(response, pathname, publicDirectory) {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = join(publicDirectory, safePath);
  try {
    if (!statSync(filePath).isFile()) {
      filePath = join(publicDirectory, 'index.html');
    }
  } catch {
    filePath = join(publicDirectory, 'index.html');
  }

  const extension = extname(filePath).toLowerCase();
  response.statusCode = 200;
  response.setHeader('content-type', CONTENT_TYPES.get(extension) || 'application/octet-stream');
  response.setHeader('cache-control', extension === '.html' ? 'no-cache' : 'public, max-age=3600');
  setSecurityHeaders(response);
  createReadStream(filePath).pipe(response);
}

function setSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'same-origin');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function send(response, status, contentType, body) {
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  setSecurityHeaders(response);
  response.end(body);
}

export function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 3000);
  const server = createServer(createRequestHandler(options));
  server.listen(port, '0.0.0.0', () => {
    console.log(`Cloud Health portal listening on port ${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
