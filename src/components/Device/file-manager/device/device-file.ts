import { escapeArg } from '@yume-chan/adb';

import { mimeOf, streamTypeOf } from '../model/mime';
import { readBytes, requireDevice, withSync } from './fs';
import { type IoPriority, runIo } from './io-queue';
import type { FileEntry } from '../model/types';

/** 与 public/sw.js 里的前缀保持一致 */
const FILE_PREFIX = '__device-file/';
/** dd 的块大小，请求范围先按它对齐，读取后再截去多余部分 */
const BLOCK_SIZE = 64 * 1024;
/** 探测链路是否可用时请求的字节数 */
const PROBE_BYTES = 2;

type ReadRequest = { type: 'device-file-read'; path: string; start: number; end: number };
/** 预览里的相对资源：完整读取，不分片 */
type FullRequest = { type: 'device-file-full'; path: string };

let service: Promise<ServiceWorkerRegistration | null> | null = null;
let listening = false;
let controllerReady: Promise<void> | null = null;

/**
 * adb 的 sync 通道只接受路径，不支持指定偏移，分片读取借 dd 完成：
 * 按块大小对齐起点，多读的部分在返回前截去
 * 走 none 协议，与其它子进程调用一致，不依赖可选的 shell 协议
 * dd 的统计信息写在 stderr，status=none 抑制它，输出即为纯文件字节
 */
export const readRange = async (
  path: string,
  start: number,
  end: number,
  priority: IoPriority = 'interactive'
) => {
  const aligned = start - (start % BLOCK_SIZE);
  const wanted = end - aligned;
  const command = [
    'dd',
    `if=${path}`,
    `bs=${BLOCK_SIZE}`,
    `skip=${aligned / BLOCK_SIZE}`,
    `count=${Math.ceil(wanted / BLOCK_SIZE)}`,
    'status=none',
  ];
  const child = await runIo(priority, () => requireDevice().subprocess.noneProtocol!.spawn(command.map(escapeArg)));

  const target = new Uint8Array(Math.max(0, end - start));
  /** 结果区间在读取块内的起点，前面的对齐部分是多余的 */
  const offset = start - aligned;
  let received = 0;
  let filled = 0;
  const reader = child.output.getReader();
  try {
    while (received < wanted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const chunkStart = received;
      received += value.length;
      const from = Math.max(chunkStart, offset);
      const to = Math.min(received, offset + target.length);
      if (to > from) {
        target.set(value.subarray(from - chunkStart, to - chunkStart), filled);
        filled += to - from;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return filled === target.length ? target : target.slice(0, filled);
};

/** 已取回的文件总长，分片响应要写完整的 Content-Range，同一路径短时间内复用已缓存的长度 */
const SIZE_TTL = 30000;
const SIZE_CACHE_LIMIT = 32;
const sizes = new Map<string, { size: number; at: number }>();

const statSize = async (path: string) => {
  const cached = sizes.get(path);
  if (cached && Date.now() - cached.at <= SIZE_TTL) return cached.size;
  const info = await runIo('interactive', () => withSync((sync) => sync.stat(path), { retry: true }));
  const size = Number(info.size);
  if (sizes.size >= SIZE_CACHE_LIMIT) {
    const oldest = sizes.keys().next().value;
    if (oldest !== undefined) sizes.delete(oldest);
  }
  sizes.set(path, { size, at: Date.now() });
  return size;
};

const handleRead = async (request: ReadRequest, port: MessagePort) => {
  try {
    const size = await statSize(request.path);
    const end = Math.min(request.end, size);
    const data = end > request.start ? await readRange(request.path, request.start, end) : new Uint8Array();
    port.postMessage({ ok: true, buffer: data.buffer, type: streamTypeOf(request.path), size });
  } catch {
    // 读取失败可能因为文件已经变化，总长下次重新取
    sizes.delete(request.path);
    port.postMessage({ ok: false });
  } finally {
    port.close();
  }
};

const handleFull = async (request: FullRequest, port: MessagePort) => {
  try {
    const merged = await readBytes(request.path, { size: sizes.get(request.path)?.size });
    port.postMessage({ ok: true, buffer: merged.buffer, type: mimeOf(request.path) });
  } catch {
    port.postMessage({ ok: false });
  } finally {
    port.close();
  }
};

const listen = () => {
  if (listening) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const request = event.data as ReadRequest | FullRequest | undefined;
    const port = event.ports[0];
    if (!port || !request) return;
    if (request.type === 'device-file-read') {
      void handleRead(request, port);
    } else if (request.type === 'device-file-full') {
      void handleFull(request, port);
    }
  });
};

/** 首次注册后页面还不在 Service Worker 的控制下，等接管完成再让预览发请求 */
const waitForController = () => {
  if (navigator.serviceWorker.controller) return Promise.resolve();
  controllerReady ??= new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
  return controllerReady;
};

/** 注册设备文件代理，返回可用前缀；环境不支持时返回 null */
export const ensureDeviceFileService = async () => {
  if (!('serviceWorker' in navigator)) return null;
  service ??= (async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI));
      await navigator.serviceWorker.ready;
      listen();
      return registration;
    } catch {
      return null;
    }
  })();
  const registration = await service;
  if (!registration) return null;
  await waitForController();
  return registration.scope;
};

/** 设备路径直接写入地址，每段单独编码，空格与 # 不会把地址截断 */
const encodePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/**
 * 设备文件的地址：类型与长度由页面在响应里带上，地址里只留路径
 * 末尾有无斜杠决定是文件还是目录，它就是文档里相对路径的基准
 */
export const deviceFileSource = (scope: string, entry: FileEntry) => ({
  src: `${scope}${FILE_PREFIX}${encodePath(entry.path)}`,
  type: streamTypeOf(entry.name),
});

/** 目录形态的地址，以 / 结尾，HTML 预览拿它当 <base> */
export const deviceFileBase = (scope: string, dir: string) => {
  const path = encodePath(dir);
  return `${scope}${FILE_PREFIX}${path ? `${path}/` : ''}`;
};

/** 读取两个字节，确认 Service Worker 拦截与设备端读取均正常 */
export const probeDeviceFile = async (src: string) => {
  try {
    const response = await fetch(src, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } });
    return response.status === 206;
  } catch {
    return false;
  }
};
