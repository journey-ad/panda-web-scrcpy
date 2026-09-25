import { onScopeDispose, watch, type ComputedRef, type Ref } from 'vue';

import { thumbOf } from '../format/registry';
import { useSettings } from '../shared/settings';
import type { FileEntry } from '../model/types';
import { useThumbCache } from './thumb-cache';

/** 同时读取的缩略图数量 */
const CONCURRENCY = 3;

/**
 * 网格视图的缩略图队列：限量读取，只排当前视口内的条目，滚动时随视口重排
 * 生成器由各类型自行登记，这里只负责调度，不关心某一种图是怎么来的
 * 生成好的图按「路径 + 修改时间 + 大小」留在缓存里，刷新目录时未变化的文件不重新读取
 */
export const useThumbnails = (viewMode: Ref<'list' | 'grid'>, inViewport: ComputedRef<FileEntry[]>) => {
  const prefs = useSettings();
  const { thumbs, labels, failed, restore, storedOf, remember, reset: resetCache, drop } = useThumbCache();
  /** 已经开始读取的路径，重排队列时跳过 */
  const running = new Set<string>();
  /** 等待读取的条目，数组顺序即读取顺序 */
  const queue: FileEntry[] = [];
  /** 当前视口内的路径，只有仍在视口里的结果才写回列表引用 */
  let inView = new Set<string>();
  let active = 0;
  let generation = 0;

  /** 切换目录或视图时作废在途结果，缓存里的对象地址不动 */
  const reset = () => {
    resetCache();
    queue.length = 0;
    running.clear();
    inView.clear();
    generation += 1;
  };

  const load = async (entry: FileEntry, token: number) => {
    const strategy = thumbOf(entry);
    if (!strategy) {
      failed.add(entry.path);
      return;
    }
    try {
      // 本地已缓存的图优先使用，不读取设备
      const stored = await storedOf(entry);
      if (token !== generation) return;
      const thumb = stored ?? (await strategy.loader(entry));
      // 这份结果对应的列表已经作废，不进缓存
      if (token !== generation) return;
      remember(entry, thumb ?? {}, inView.has(entry.path));
      if (!thumb?.blob && !thumb?.label) failed.add(entry.path);
    } catch {
      failed.add(entry.path);
    }
  };

  const pump = () => {
    while (active < CONCURRENCY && queue.length) {
      const entry = queue.shift()!;
      active += 1;
      running.add(entry.path);
      load(entry, generation).finally(() => {
        active -= 1;
        running.delete(entry.path);
        pump();
      });
    }
  };

  /** 值得生成的条件由类型自己给出：是否登记了生成器，以及对这个条目的体积限制 */
  const thumbable = (entry: FileEntry) => {
    if (entry.isDirectory || !entry.size) return false;
    const strategy = thumbOf(entry);
    return !!strategy && strategy.eligible(entry);
  };

  /** 视口变化后重建队列：只排视口内的条目，尚未开始的移除，新进入的按视口顺序排在前面 */
  const sync = () => {
    if (viewMode.value !== 'grid' || !prefs.gridShowThumbnails) {
      // 关掉缩略图后列表里不留旧图，缓存仍持有对象地址，重新打开时直接命中
      if (thumbs.value.size || labels.value.size) reset();
      return;
    }
    const target = inViewport.value;
    inView = new Set(target.map((entry) => entry.path));
    restore(target);
    queue.length = 0;
    queue.push(
      ...target.filter(
        (entry) =>
          thumbable(entry) &&
          !thumbs.value.has(entry.path) &&
          !failed.has(entry.path) &&
          !running.has(entry.path)
      )
    );
    pump();
  };

  /** 跨行滚动连续触发，合并成一帧内的处理，减少队列重建次数 */
  let syncTimer = 0;
  const scheduleSync = () => {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = 0;
      sync();
    }, 120);
  };
  onScopeDispose(() => clearTimeout(syncTimer));

  watch([viewMode, inViewport, () => prefs.gridShowThumbnails], scheduleSync);

  return { thumbs, labels, reset, drop };
};
