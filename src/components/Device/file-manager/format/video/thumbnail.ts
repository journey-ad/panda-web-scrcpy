import { deviceFileSource, ensureDeviceFileService, probeDeviceFile, readRange } from '../../device/device-file';
import { isMp4Family } from '../../model/mime';
import type { FileEntry, Thumb } from '../../model/types';
import { scaleImageBlob, THUMB_MAX_EDGE, videoPosterBlob } from '../image/bitmap';
import { embeddedCoverBlob } from './cover';

/** 视频封面经 Service Worker 代理按需读取字节，探测一次后共用结果 */
let scopePromise: Promise<string | null> | null = null;

const videoScope = (entry: FileEntry) => {
  scopePromise ??= (async () => {
    const registered = await ensureDeviceFileService();
    const usable = registered ? await probeDeviceFile(deviceFileSource(registered, entry).src) : false;
    return usable ? registered : null;
  })();
  return scopePromise;
};

/** 有大小即可按需读取，代理不可用时由 loader 返回空 */
export const eligible = (entry: FileEntry) => !!entry.size;

export const loader = async (entry: FileEntry): Promise<Thumb | null> => {
  const scope = await videoScope(entry);
  if (!scope) return null;
  const source = deviceFileSource(scope, entry).src;
  // MP4 内嵌封面优先使用，读的是固定的少量字节
  if (isMp4Family(entry.name)) {
    const cover = await embeddedCoverBlob(entry.size, (start, end) => readRange(entry.path, start, end, 'background'));
    const still = cover ? await scaleImageBlob(cover, THUMB_MAX_EDGE) : null;
    if (still) return { blob: still };
  }
  const poster = await videoPosterBlob(source, THUMB_MAX_EDGE);
  return poster ? { blob: poster } : null;
};
