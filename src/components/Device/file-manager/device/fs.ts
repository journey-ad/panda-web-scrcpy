import { escapeArg, LinuxFileType, type AdbSync, type AdbSyncEntry } from '@yume-chan/adb';

import client from '../../../Scrcpy/adb-client';
import { codeOf, DeviceError } from '../model/errors';
import type { RawEntry } from '../model/types';
import { joinPath } from '../shared/utils';
import { runIo, type IoPriority } from './io-queue';

/** 获取当前连接，未连接时抛错，调用方无需判空 */
export const requireDevice = () => {
  const adb = client.device;
  if (!adb) {
    throw new DeviceError('disconnected', '设备未连接');
  }
  return adb;
};

/** 空闲的 sync 会话数，与 io-queue 的并发上限一致 */
const IDLE_LIMIT = 2;
/** 空闲会话的保留时长，超过就关闭 */
const IDLE_TTL = 5000;

const idle: { sync: AdbSync; at: number }[] = [];

/** 取一个空闲会话，过期的直接关闭 */
const takeIdle = () => {
  for (;;) {
    const slot = idle.pop();
    if (!slot) return null;
    if (Date.now() - slot.at <= IDLE_TTL) return slot.sync;
    void slot.sync.dispose().catch(() => {});
  }
};

const releaseIdle = (sync: AdbSync) => {
  if (idle.length >= IDLE_LIMIT) {
    void sync.dispose().catch(() => {});
    return;
  }
  idle.push({ sync, at: Date.now() });
};

export interface SyncOptions {
  /** 复用的会话可能已被设备回收，失败时新建会话重试一次；只有幂等的读取可以打开 */
  retry?: boolean;
}

/**
 * 打开 sync 会话执行操作，结束后归还到空闲池
 * 出错时会话状态未知，直接关闭不放回
 */
export const withSync = async <T>(
  handler: (sync: AdbSync) => Promise<T>,
  options: SyncOptions = {}
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    const reused = attempt === 0 ? takeIdle() : null;
    const sync = reused ?? (await requireDevice().sync());
    try {
      const result = await handler(sync);
      releaseIdle(sync);
      return result;
    } catch (error) {
      void sync.dispose().catch(() => {});
      if (!reused || !options.retry) throw error;
    }
  }
};

export const exec = async (args: string[]) => {
  const adb = requireDevice();
  return await runIo('interactive', () => adb.subprocess.noneProtocol!.spawnWaitText(args.map(escapeArg)));
};

export interface CommandResult {
  code: number;
  output: string;
}

/**
 * 需要退出码时用 shell 协议，exec() 走的 none 协议不返回退出码
 * 命令交给设备上的 sh 执行，因此重定向与管道可用，参数需自行 escapeArg
 */
export const runShell = async (command: string): Promise<CommandResult> => {
  const shell = requireDevice().subprocess.shellProtocol;
  if (!shell?.isSupported) {
    throw new DeviceError('unsupported', '设备不支持 shell 协议');
  }
  const { exitCode, stdout, stderr } = await runIo('interactive', () => shell.spawnWaitText(command));
  return { code: exitCode, output: `${stdout}${stderr}`.trim() };
};

interface LinkInfo {
  isDirectory: boolean;
  size?: number;
  mtime?: number;
}

/**
 * 软链接在 readdir 里只给出自身的信息，需额外解析一次才能判断指向目录还是文件
 * 指向目录时按目录处理，指向文件时尽量取回真实的大小与修改时间
 * 解析不出来的链接返回 null，条目按 readdir 给出的信息列出
 */
const resolveLink = async (sync: AdbSync, path: string): Promise<LinkInfo | null> => {
  try {
    // stat 会解析链接，一次请求同时给出类型、大小与修改时间
    const stat = await sync.stat(path);
    return stat.type === LinuxFileType.Directory
      ? { isDirectory: true }
      : { isDirectory: false, size: Number(stat.size), mtime: Number(stat.mtime) * 1000 };
  } catch {
    try {
      // 设备不支持 STAT 时退回 lstat，只判得出是否为目录
      return { isDirectory: await sync.isDirectory(path) };
    } catch {
      return null;
    }
  }
};

/**
 * 只产出设备给出的原始信息，kind 与 preview 由格式层补齐
 * 设备层不感知文件类型
 */
const toEntry = (dir: string, item: AdbSyncEntry, resolved?: LinkInfo | null): RawEntry => {
  const isDirectory = resolved ? resolved.isDirectory : item.type === LinuxFileType.Directory;
  return {
    name: item.name,
    path: joinPath(dir, item.name),
    isDirectory,
    isLink: item.type === LinuxFileType.Link,
    size: resolved?.size ?? Number(item.size),
    mtime: resolved?.mtime ?? Number(item.mtime) * 1000,
  };
};

export const readDir = async (path: string): Promise<RawEntry[]> =>
  runIo('interactive', () =>
    withSync(
      async (sync) => {
        const list = await sync.readdir(path);
        const entries: RawEntry[] = [];
        for (const item of list) {
          if (item.name === '.' || item.name === '..') continue;
          // 链接单独解析，普通条目不做额外请求
          const resolved =
            item.type === LinuxFileType.Link ? await resolveLink(sync, joinPath(path, item.name)) : undefined;
          entries.push(toEntry(path, item, resolved));
        }
        return entries;
      },
      { retry: true }
    )
  );

/** 路径是否为设备上已存在的目录，用于跳转前的校验；设备断开时上抛，其余读取失败按不存在处理 */
export const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return await runIo('interactive', () => withSync((sync) => sync.isDirectory(path), { retry: true }));
  } catch (error) {
    if (codeOf(error) === 'disconnected') throw error;
    return false;
  }
};

export interface ReadOptions {
  /** 缩略图这类批量读取用 background，浏览与命令优先执行 */
  priority?: IoPriority;
  onProgress?: (read: number) => void;
  /** 已知文件长度时按它预分配 */
  size?: number;
  /** 取消后停止读取，已经读到的内容丢弃 */
  signal?: AbortSignal;
}

/** 逐个读出分片交给 sink，读取过程中检查是否已取消 */
const readChunks = async (path: string, options: ReadOptions, sink: (chunk: Uint8Array) => void) => {
  const { signal } = options;
  await runIo(options.priority ?? 'interactive', () =>
    withSync(
      async (sync) => {
        const reader = sync.read(path).getReader();
        let received = 0;
        for (;;) {
          if (signal?.aborted) {
            await reader.cancel().catch(() => {});
            throw new DOMException('读取已取消', 'AbortError');
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          sink(value);
          received += value.length;
          options.onProgress?.(received);
        }
      },
      { retry: true }
    )
  );
};

export const readFile = async (path: string, options: ReadOptions = {}): Promise<Uint8Array[]> => {
  const result: Uint8Array[] = [];
  await readChunks(path, options, (chunk) => result.push(chunk));
  return result;
};

/** 完整读取并写成一份连续内存，按已知长度预分配，长度不足时按需扩容 */
export const readBytes = async (path: string, options: ReadOptions = {}): Promise<Uint8Array> => {
  let buffer = new Uint8Array(Math.max(0, options.size ?? 0));
  let length = 0;
  await readChunks(path, options, (chunk) => {
    if (length + chunk.length > buffer.length) {
      const grown = new Uint8Array(Math.max(buffer.length * 2, length + chunk.length));
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    }
    buffer.set(chunk, length);
    length += chunk.length;
  });
  return length === buffer.length ? buffer : buffer.slice(0, length);
};

export const toBlob = (chunks: Uint8Array[], type: string) => new Blob(chunks as BlobPart[], { type });

export interface FoundEntry {
  path: string;
  isDirectory: boolean;
}

/** 一次搜索最多带回的条目数，目录与文件各算一份 */
const FOUND_LIMIT = 500;

/** find 不进入作为起点的符号链接，/sdcard 即属此类；末尾补 /. 让它越过符号链接继续搜索 */
const insidePath = (root: string) => (root.endsWith('/') ? `${root}.` : `${root}/.`);

/**
 * 按名字递归查找：命令在设备上跑，比逐个目录读回来快得多
 * 目录与文件分两趟，合起来一次往返；结果只带路径，大小与时间不参与
 */
export const searchFiles = async (root: string, keyword: string, limit = FOUND_LIMIT) => {
  const start = insidePath(root);
  const pattern = escapeArg(`*${keyword}*`);
  const list = (type: string) =>
    `find ${escapeArg(start)} -type ${type} -iname ${pattern} | head -n ${limit}`;
  const { output } = await runShell(`${list('d')}; echo '#files#'; ${list('f')}`);

  const lines = output.split('\n').map((line) => line.trim());
  const split = lines.indexOf('#files#');
  // 结果里带着 /. 这一段，换回调用方给的路径
  const collect = (items: string[], isDirectory: boolean) =>
    items
      .filter((item) => item.startsWith(start))
      .map((path) => ({ path: path.replace(start, root), isDirectory }));
  const dirs = collect(lines.slice(0, split < 0 ? lines.length : split), true);
  const files = collect(split < 0 ? [] : lines.slice(split + 1), false);
  return {
    entries: [...dirs, ...files],
    truncated: dirs.length >= limit || files.length >= limit,
  };
};
