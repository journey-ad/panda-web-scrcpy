import { mdiFileDocumentOutline, mdiFolder } from '@mdi/js';

import { colorOf, iconOf } from '../format/registry';
import type { FileEntry } from '../model/types';

/**
 * 图标与配色由各类型自行登记，这里只处理目录与未收录类型
 * 这两个值留在视图层，注册表里只登记具体的文件类型
 */
export const entryIcon = (entry: FileEntry) => {
  if (entry.isDirectory) return mdiFolder;
  return iconOf(entry) ?? mdiFileDocumentOutline;
};

export const entryColor = (entry: FileEntry) => {
  if (entry.isDirectory) return 'amber-darken-2';
  return colorOf(entry) ?? 'grey';
};
