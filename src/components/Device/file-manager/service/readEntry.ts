import { readBytes } from '../device/fs';
import type { IoPriority } from '../device/io-queue';
import type { FileEntry } from '../model/types';

interface EntryReadOptions {
  signal?: AbortSignal;
  priority?: IoPriority;
  /** 读取进度 0–1 */
  onProgress?: (value: number) => void;
}

/**
 * 预览读取设备文件：按条目长度预分配，进度按条目长度换算
 * 组件卸载时传入 signal 即可中断读取
 */
export const readEntry = (entry: FileEntry, options: EntryReadOptions = {}) => {
  const { onProgress } = options;
  return readBytes(entry.path, {
    size: entry.size,
    signal: options.signal,
    priority: options.priority,
    onProgress: onProgress
      ? (read) => onProgress(entry.size ? Math.min(read / entry.size, 1) : 1)
      : undefined,
  });
};
