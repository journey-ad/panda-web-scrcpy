import { onScopeDispose, ref } from 'vue';

import type { FileEntry, Thumb } from '../model/types';
import { dropThumb, readThumb, writeThumb } from './thumb-store';

/** 缓存里的缩略图，key 是文件自身的标识，文件被改动后标识不同、自动重新生成 */
interface CachedThumb {
  key: string;
  url?: string;
  label?: string;
  bytes: number;
  failed?: boolean;
}

/** 张数与总字节数的上限，图已经缩放过，两个都限住内存才不会随浏览增长 */
const CACHE_MAX = 120;
const CACHE_BYTES = 24 * 1024 * 1024;

/**
 * 缩略图的对象地址由缓存唯一持有，thumbs / labels 只是当前列表的引用
 * 生成结果同时写入 IndexedDB，下次打开同一文件直接读取本地的一份
 */
export const useThumbCache = () => {
  const thumbs = ref(new Map<string, string>());
  const labels = ref(new Map<string, string>());
  /** 生成失败的条目标记为不重试 */
  const failed = new Set<string>();
  const cache = new Map<string, CachedThumb>();
  let cachedBytes = 0;

  const keyOf = (entry: FileEntry) => `${entry.mtime}:${entry.size}`;

  const release = (path: string) => {
    const hit = cache.get(path);
    if (!hit) return;
    if (hit.url) URL.revokeObjectURL(hit.url);
    cachedBytes -= hit.bytes;
    cache.delete(path);
  };

  /** 超出上限就淘汰最早的一条；正在展示的不移除，界面上的图保持显示
   *  当前目录本身超过上限时不淘汰，内存占用与不设缓存时相同 */
  const trim = () => {
    for (const path of cache.keys()) {
      if (cache.size <= CACHE_MAX && cachedBytes <= CACHE_BYTES) return;
      if (thumbs.value.has(path)) continue;
      release(path);
    }
  };

  /** 视口内的条目命中内存缓存时直接用于当前列表 */
  const restore = (target: FileEntry[]) => {
    for (const entry of target) {
      const hit = cache.get(entry.path);
      if (!hit || hit.key !== keyOf(entry)) continue;
      if (hit.url) thumbs.value.set(entry.path, hit.url);
      if (hit.label) labels.value.set(entry.path, hit.label);
      if (hit.failed) failed.add(entry.path);
    }
  };

  /** 取本地存储里的图，文件已经被改动时作废这一条 */
  const storedOf = async (entry: FileEntry): Promise<Thumb | null> => {
    const stored = await readThumb(entry.path);
    if (!stored) return null;
    if (stored.key !== keyOf(entry)) {
      void dropThumb(entry.path);
      return null;
    }
    return { blob: stored.blob, label: stored.label || undefined };
  };

  /** 结果留在缓存里；条目已经滚出视口时只写缓存，不写回当前列表 */
  const remember = (entry: FileEntry, thumb: Thumb, inView: boolean) => {
    release(entry.path);
    const blob = thumb.blob;
    const url = blob ? URL.createObjectURL(blob) : undefined;
    cache.set(entry.path, {
      key: keyOf(entry),
      url,
      label: thumb.label,
      bytes: blob?.size ?? 0,
      failed: !blob && !thumb.label,
    });
    cachedBytes += blob?.size ?? 0;
    if (blob) void writeThumb(entry.path, keyOf(entry), blob, thumb.label ?? '');
    if (!inView) {
      trim();
      return;
    }
    if (url) thumbs.value.set(entry.path, url);
    if (thumb.label) labels.value.set(entry.path, thumb.label);
    trim();
  };

  /** 只清当前列表的引用，对象地址仍留在缓存里 */
  const reset = () => {
    thumbs.value = new Map();
    labels.value = new Map();
    failed.clear();
  };

  /** 渲染失败后标记为不重试，同时把它从缓存与本地存储里移除 */
  const drop = (path: string) => {
    release(path);
    void dropThumb(path);
    thumbs.value.delete(path);
    labels.value.delete(path);
    failed.add(path);
  };

  onScopeDispose(() => {
    for (const hit of cache.values()) {
      if (hit.url) URL.revokeObjectURL(hit.url);
    }
    cache.clear();
  });

  return { thumbs, labels, failed, keyOf, restore, storedOf, remember, reset, drop };
};
