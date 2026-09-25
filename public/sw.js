/* global self */

/**
 * 设备文件的虚拟文件系统。设备路径直接写进地址，只有一种形态：
 *   __device-file/<每段各自编码的设备路径>
 * 末尾带斜杠是目录（HTML 预览拿它当 <base>，相对资源照设备目录拼出来），
 * 不带就是文件；分片一律看浏览器发来的 HTTP Range 头，没有就是整份
 * 字节、类型、文件总长都来自页面——它才持有 adb 连接
 */

/** 交给 Service Worker 的虚拟路径前缀 */
const FILE_PREFIX = '__device-file/';
/** 单次分片的上限，open-ended 的 Range 不能让它一次拉完整个文件 */
const MAX_CHUNK = 4 * 1024 * 1024;
/** 等待页面回数据的上限 */
const READ_TIMEOUT = 30000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  // 首次注册时页面还没被接管，先接管再让预览发请求
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const prefix = new URL(FILE_PREFIX, self.registration.scope).pathname;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) {
    return;
  }
  const path = devicePath(url.pathname.slice(prefix.length));
  if (!path) {
    return;
  }
  event.respondWith(respond(event, path));
});

/** 目录形态的地址每段单独编码过，解出来才是设备上的真实路径 */
const devicePath = (tail) => {
  const segments = tail.split('/').filter(Boolean);
  if (!segments.length) return null;
  try {
    return `/${segments.map(decodeURIComponent).join('/')}`;
  } catch {
    return null;
  }
};

/** 只认闭区间与 open-ended 两种；返回 null 表示整份取 */
const parseRange = (header) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec((header || '').trim());
  if (!match) return null;
  const start = Number(match[1]);
  return { start, end: Math.min(match[2] ? Number(match[2]) + 1 : Infinity, start + MAX_CHUNK) };
};

/** 已经取回的分片，回看同一段时不再向页面要数据 */
const CACHE_LIMIT = 12 * 1024 * 1024;
/** 缓存条目的有效期，设备上的文件变化后不再复用 */
const CACHE_TTL = 60000;
const cache = new Map();
let cachedBytes = 0;

const cacheKey = (path, range) => (range ? `${path}#${range.start}-${range.end}` : `${path}#full`);

const readCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    cachedBytes -= hit.reply.buffer.byteLength;
    return null;
  }
  // 命中后移到末尾，淘汰时先丢掉最早的一条
  cache.delete(key);
  cache.set(key, hit);
  return hit.reply;
};

const writeCache = (key, reply) => {
  const bytes = reply.buffer.byteLength;
  if (!bytes || bytes > CACHE_LIMIT) return;
  while (cachedBytes + bytes > CACHE_LIMIT && cache.size) {
    const oldest = cache.keys().next().value;
    cachedBytes -= cache.get(oldest).reply.buffer.byteLength;
    cache.delete(oldest);
  }
  cache.set(key, { reply, at: Date.now() });
  cachedBytes += bytes;
};

async function respond(event, path) {
  const range = parseRange(event.request.headers.get('range'));
  const key = cacheKey(path, range);
  const cached = readCache(key);
  const reply =
    cached ??
    (await askPage(
      event,
      range
        ? { type: 'device-file-read', path, start: range.start, end: range.end }
        : { type: 'device-file-full', path }
    ));
  if (!reply) {
    return new Response('not found', { status: 404 });
  }
  if (!cached) writeCache(key, reply);
  if (!range) {
    return new Response(reply.buffer, { status: 200, headers: { ...baseHeaders(reply), 'Content-Length': String(reply.buffer.byteLength) } });
  }
  if (range.start >= reply.size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${reply.size}` } });
  }

  const end = range.start + reply.buffer.byteLength - 1;
  return new Response(reply.buffer, {
    status: 206,
    headers: {
      ...baseHeaders(reply),
      'Content-Length': String(reply.buffer.byteLength),
      'Content-Range': `bytes ${range.start}-${end}/${reply.size}`,
    },
  });
}

const baseHeaders = (reply) => ({
  'Content-Type': reply.type || 'application/octet-stream',
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'no-store',
});

/** 把请求转交给持有 adb 连接的页面，拿回 { buffer, type, size } 或 null */
async function askPage(event, payload) {
  const client = await resolveClient(event);
  if (!client) {
    return null;
  }

  const channel = new MessageChannel();
  let timer = 0;
  const result = new Promise((resolve) => {
    const settle = (value) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(value);
    };
    timer = setTimeout(() => settle(null), READ_TIMEOUT);
    channel.port1.onmessage = (message) => settle(message.data?.ok ? message.data : null);
  });
  client.postMessage(payload, [channel.port2]);
  return await result;
}

/**
 * 找真正能读设备的那个页面。相对资源由预览用的 iframe 发起，它自己不监听消息，
 * 所以要退回主框架去问
 */
async function resolveClient(event) {
  const initiator = event.clientId ? await self.clients.get(event.clientId) : null;
  if (initiator && initiator.frameType === 'top-level') {
    return initiator;
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.find((client) => client.frameType === 'top-level') || initiator || windows[0] || null;
}
