import { ref, type Ref } from 'vue';

import { exec } from '../device/fs';
import { failText } from '../model/errors';
import type { FileEntry } from '../model/types';
import { filterNameChars, joinPath, parentPath } from '../shared/utils';

/** 名称里不能出现的字符，与 filterNameChars 的规则对应 */
const INVALID_NAME_HINT = '名称不能使用 / \\ : * ? " < > | 等符号';

interface FileCommandOptions {
  currentPath: Ref<string>;
  /** 新建目录后直接插入列表 */
  addDirectory: (name: string) => void;
  /** 重命名后替换列表里的条目 */
  replaceEntry: (entry: FileEntry, name: string) => void;
  notify: (text: string, type?: 'error' | 'success') => void;
}

/** 新建目录与重命名：命令在设备上执行，成功后直接改列表，不重读目录 */
export const useFileCommands = (options: FileCommandOptions) => {
  const { currentPath, notify } = options;

  const mkdirDialog = ref(false);
  const mkdirName = ref('');
  const mkdirError = ref('');

  const renameDialog = ref(false);
  const renameName = ref('');
  const renameTarget = ref<FileEntry | null>(null);
  const renameError = ref('');

  /** 输入时实时过滤特殊符号，有字符被过滤时给出提示 */
  const filterName = (value: string, error: Ref<string>) => {
    const cleaned = filterNameChars(value);
    error.value = cleaned === value ? '' : INVALID_NAME_HINT;
    return cleaned;
  };

  const setMkdirName = (value: string) => {
    mkdirName.value = filterName(value, mkdirError);
  };

  const setRenameName = (value: string) => {
    renameName.value = filterName(value, renameError);
  };

  /** 失焦或内容提交后清除提示 */
  const clearNameError = () => {
    mkdirError.value = '';
    renameError.value = '';
  };

  const openMkdirDialog = () => {
    mkdirName.value = '';
    mkdirError.value = '';
    mkdirDialog.value = true;
  };

  const confirmMkdir = async () => {
    const name = mkdirName.value.trim();
    if (!name) {
      mkdirError.value = '名称不能为空';
      return;
    }
    mkdirDialog.value = false;
    try {
      await exec(['mkdir', '-p', joinPath(currentPath.value, name)]);
      options.addDirectory(name);
      notify('已创建目录');
    } catch (error) {
      notify(failText('创建目录', error), 'error');
    }
  };

  const openRename = (entry: FileEntry) => {
    renameTarget.value = entry;
    renameName.value = entry.name;
    renameError.value = '';
    renameDialog.value = true;
  };

  const confirmRename = async () => {
    const entry = renameTarget.value;
    const name = renameName.value.trim();
    if (!entry) return;
    if (!name) {
      renameError.value = '名称不能为空';
      return;
    }
    renameDialog.value = false;
    if (name === entry.name) return;
    try {
      await exec(['mv', '-f', entry.path, joinPath(parentPath(entry.path), name)]);
      options.replaceEntry(entry, name);
      notify('已重命名');
    } catch (error) {
      notify(failText('重命名', error), 'error');
    }
  };

  return {
    mkdirDialog,
    mkdirName,
    mkdirError,
    renameDialog,
    renameName,
    renameTarget,
    renameError,
    setMkdirName,
    setRenameName,
    clearNameError,
    openMkdirDialog,
    openRename,
    confirmMkdir,
    confirmRename,
  };
};
