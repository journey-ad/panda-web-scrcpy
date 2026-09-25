/** 图片缩略图：完整读入后取首帧再缩放，超过这个体积就不生成 */
const MAX_SIZE = 24 * 1024 * 1024;

import { mimeOf } from '../../model/mime';
import { firstFrameBlob, scaleImageBlob, THUMB_MAX_EDGE } from './bitmap';
import { readFile } from '../../device/fs';
import type { FileEntry, Thumb } from '../../model/types';

export const eligible = (entry: FileEntry) => !!entry.size && entry.size <= MAX_SIZE;

/** 动图只保留首帧，网格里不会自动播放 */
export const loader = async (entry: FileEntry): Promise<Thumb | null> => {
  const chunks = await readFile(entry.path, { priority: 'background' });
  const blob = new Blob(chunks as BlobPart[], { type: mimeOf(entry.name) });
  const still = await firstFrameBlob(blob);
  const small = await scaleImageBlob(still ?? blob, THUMB_MAX_EDGE);
  return small ? { blob: small } : null;
};
