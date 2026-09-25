import { readRange } from '../../device/device-file';
import { mimeOf } from '../../model/mime';
import type { FileEntry, Thumb } from '../../model/types';
import { scaleImageBlob, THUMB_MAX_EDGE } from '../image/bitmap';
import { analyzeApk } from './parser';

/**
 * 安装包只按需读中央目录、清单与图标这几个片段，不整体读取
 * 应用名随缩略图一起带回，网格里显示在文件名后面
 */
export const loader = async (entry: FileEntry): Promise<Thumb | null> => {
  const info = await analyzeApk(entry.size, (start, end) => readRange(entry.path, start, end, 'background'));
  const label = info.label || '';
  const icon = info.icon;
  if (!icon) return label ? { label } : null;
  const small = await scaleImageBlob(new Blob([icon.data as BlobPart], { type: mimeOf(icon.path) }), THUMB_MAX_EDGE);
  return { blob: small ?? undefined, label };
};

export const eligible = (entry: FileEntry) => !!entry.size;
