import { ref } from 'vue';

import type { LocalFile } from '../model/types';

export interface DropResult {
  files: LocalFile[];
  /** 拖进来的空目录，浏览器不会给出里面的文件 */
  dirs: string[];
}

interface DropOptions {
  /** 设备可用时才允许投放 */
  canDrop: () => boolean;
  /** 投放结果，取出的是本机文件与其相对路径 */
  onFiles: (result: DropResult) => void;
}

/** 目录要读完一批再读下一批，readEntries 单次最多给 100 项 */
const readAll = async (reader: FileSystemDirectoryReader) => {
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) return entries;
    entries.push(...batch);
  }
};

/** 递归取出目录里的文件，空目录单独记一条 */
const walk = async (entry: FileSystemEntry, prefix: string, result: DropResult) => {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) result.files.push({ file, path: `${prefix}${entry.name}` });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children = await readAll(reader);
  if (!children.length) result.dirs.push(`${prefix}${entry.name}`);
  for (const child of children) {
    await walk(child, `${prefix}${entry.name}/`, result);
  }
};

/**
 * 窗口级的拖拽投放：只维护悬停状态并取出文件，是否接受由调用方判断
 */
export const useFileDrop = (options: DropOptions) => {
  const dragging = ref(false);
  /** 指针在容器内跨越子元素时会成对触发进出，用计数判断是否真正离开 */
  let depth = 0;

  const hasFilePayload = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files') || (event.dataTransfer?.files?.length ?? 0) > 0;

  const onDragEnter = (event: DragEvent) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    if (!options.canDrop()) return;
    depth += 1;
    dragging.value = true;
  };

  const onDragOver = (event: DragEvent) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = options.canDrop() ? 'copy' : 'none';
    }
  };

  const onDragLeave = (event: DragEvent) => {
    if (!hasFilePayload(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) dragging.value = false;
  };

  const onDrop = async (event: DragEvent) => {
    depth = 0;
    dragging.value = false;
    if (!hasFilePayload(event)) return;
    event.preventDefault();

    const items = Array.from(event.dataTransfer?.items ?? []);
    const result: DropResult = { files: [], dirs: [] };
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        await walk(entry, '', result);
        continue;
      }
      const file = item.getAsFile();
      if (file) result.files.push({ file, path: file.name });
    }
    if (!items.length) {
      for (const file of Array.from(event.dataTransfer?.files ?? [])) {
        result.files.push({ file, path: file.name });
      }
    }
    options.onFiles(result);
  };

  return { dragging, onDragEnter, onDragOver, onDragLeave, onDrop };
};
