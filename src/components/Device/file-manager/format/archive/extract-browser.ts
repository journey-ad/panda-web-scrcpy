/**
 * ZIP 浏览器内解压：设备端 toybox unzip 对未置 UTF-8 标志位的中文（GBK）文件名
 * 会报 Invalid entry name，此路在浏览器里用自带的 ZIP 解析按正确编码解出文件名再写回设备
 */

import { dirname } from '@yume-chan/adb';
import { ReadableStream } from '@yume-chan/stream-extra';

import { exec, readBytes, withSync } from '../../device/fs';
import { readZipEntries, readZipEntryData, type RangeReader } from '../../device/zip';
import { formatSize, joinPath } from '../../shared/utils';

/**
 * 把 ZIP 解压到设备上的 target 目录，文件名按归档内编码还原
 * 仅处理 ZIP：其余格式仍交给设备命令
 * onProgress 在推进时给出 0–1 的进度与文字，读取占前半段、写回占后半段
 */
export const extractZipInBrowser = async (
  archivePath: string,
  target: string,
  onProgress?: (value: number, detail: string) => void
): Promise<void> => {
  // stat 未返回大小时退而求其次，读完再算
  let size = 0;
  try {
    size = await withSync((sync) => sync.stat(archivePath).then((stat) => Number(stat.size)));
  } catch {
    size = 0;
  }

  // 整包读回浏览器后按条目偏移随机读取，读取进度占前半段
  const buffer = await readBytes(archivePath, {
    size: size || undefined,
    onProgress: (read) =>
      onProgress?.(size ? (read / size) * 0.5 : 0, `正在读取压缩包 ${formatSize(read)} / ${formatSize(size)}`),
  });
  if (!size) size = buffer.length;
  const read: RangeReader = (start, end) => Promise.resolve(buffer.subarray(start, end));

  const { entries } = await readZipEntries(size, read);
  if (!entries.length) return;

  const made = new Set<string>();
  // 自底向上建目录，已建过的跳过
  const ensureDir = async (dir: string) => {
    if (!dir || dir === '/' || made.has(dir)) return;
    await ensureDir(dirname(dir));
    await exec(['mkdir', '-p', dir]);
    made.add(dir);
  };

  await withSync(async (sync) => {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      onProgress?.(0.5 + (index / entries.length) * 0.5, `正在写入 ${index + 1} / ${entries.length}`);
      const dest = joinPath(target, entry.name.replace(/\\/g, '/'));
      if (entry.name.endsWith('/')) {
        await ensureDir(dest);
        continue;
      }
      await ensureDir(dirname(dest));
      const data = await readZipEntryData(entry, read);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
      await sync.write({ filename: dest, file: stream });
    }
  });
  onProgress?.(1, '解压完成');
};
