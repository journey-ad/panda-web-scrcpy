import { computed, shallowRef, type Ref } from 'vue';

import { BUSY_HINT } from './useFileTasks';
import { readDir } from '../device/fs';
import type { FileEntry } from '../model/types';
import { errorText, parentPath, uniqueName } from '../shared/utils';

/** 复制保留源文件，剪切会把源文件移走 */
export type ClipboardMode = 'copy' | 'cut';

interface ClipboardOptions {
  /** 命令执行与进度在 useFileTasks，这里只维护剪贴板状态与目标名 */
  copy: (list: FileEntry[], target: string, names: Map<string, string>) => Promise<unknown>;
  move: (list: FileEntry[], target: string, names: Map<string, string>) => Promise<unknown>;
  currentPath: Ref<string>;
  hasTask: () => boolean;
  notify: (text: string, type?: 'error' | 'success') => void;
}

/**
 * 剪贴板：跨目录复制与剪切
 */
export const useClipboard = (options: ClipboardOptions) => {
  const { currentPath, notify } = options;
  const mode = shallowRef<ClipboardMode | null>(null);
  const entries = shallowRef<FileEntry[]>([]);

  const count = computed(() => entries.value.length);
  const filled = computed(() => entries.value.length > 0);

  const put = (list: FileEntry[], next: ClipboardMode) => {
    if (!list.length) return;
    mode.value = next;
    entries.value = [...list];
    notify(`${next === 'copy' ? '已复制' : '已剪切'} ${list.length} 项到剪贴板`);
  };

  const clear = () => {
    mode.value = null;
    entries.value = [];
  };

  /** 剪切时已经在目标目录里的条目保持原位，复制则在原地生成副本 */
  const movable = (target: string) =>
    mode.value === 'cut'
      ? entries.value.filter((entry) => parentPath(entry.path) !== target)
      : entries.value;

  /** 目标目录里已有的名字，重名的往后加序号，同批之间也不重名 */
  const targetNames = async (target: string, list: FileEntry[]) => {
    const taken = new Set((await readDir(target)).map((entry) => entry.name));
    const names = new Map<string, string>();
    for (const entry of list) {
      const name = uniqueName(entry.name, taken);
      taken.add(name);
      names.set(entry.path, name);
    }
    return names;
  };

  /** 粘贴到目标目录，粘完即清空剪贴板 */
  const paste = async (target: string) => {
    if (options.hasTask()) {
      notify(BUSY_HINT, 'error');
      return;
    }
    const list = movable(target);
    if (!list.length) {
      clear();
      return;
    }
    let names: Map<string, string>;
    try {
      names = await targetNames(target, list);
    } catch (error) {
      notify(`无法读取目标目录：${errorText(error)}`, 'error');
      return;
    }
    if (mode.value === 'copy') await options.copy(list, target, names);
    else await options.move(list, target, names);
    clear();
  };

  return {
    mode,
    entries,
    count,
    filled,
    copy: (list: FileEntry[]) => put(list, 'copy'),
    cut: (list: FileEntry[]) => put(list, 'cut'),
    paste,
    pasteIntoCurrent: () => paste(currentPath.value),
    clear,
  };
};
