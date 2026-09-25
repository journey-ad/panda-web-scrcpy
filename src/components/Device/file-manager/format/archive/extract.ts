/**
 * 解压：命令在设备上执行，内容不读回浏览器
 * 与列目录分开，是因为两者的入口与调用方都不相同
 */

import { escapeArg } from '@yume-chan/adb';

/**
 * 解压在设备上执行，内容不读回浏览器
 * Android 上没有解 RAR / 7Z 的现成命令，这两类不给入口；
 * ZIP 与 tar 分别交给设备自带的 `unzip` / `tar`
 */
const EXTRACTABLE_PATTERN = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz|tbz2|tar\.xz|txz)$/i;

export const isExtractableArchive = (name: string) => EXTRACTABLE_PATTERN.test(name);

/** tar 按后缀选择压缩标志，无法识别时交给 tar 自行判断 */
const tarFlags = (name: string) => {
  const lower = name.toLowerCase();
  if (/\.(tar\.bz2|tbz2?)$/.test(lower)) return ['xjf', 'xf'];
  if (/\.(tar\.xz|txz)$/.test(lower)) return ['xJf', 'xf'];
  if (/\.(tar\.gz|tgz)$/.test(lower)) return ['xzf', 'xf'];
  return ['xf'];
};

/**
 * 依次尝试的命令，退出码为 0 即视为成功。设备上的实现是 toybox，
 * `unzip` 为 `[-d DIR] [-l] FILE`，tar 的提示为 "Needs -txc"
 * 各版本对 -o / -C 的支持不一致，每种命令给出带目录参数与 `cd` 后执行两种写法
 */
export const extractCommands = (name: string, archive: string, dir: string): (string[] | string)[] => {
  const file = escapeArg(archive);
  const target = escapeArg(dir);
  const inside = `cd ${target} && `;

  if (/\.zip$/i.test(name)) {
    return [
      ['unzip', '-o', file, '-d', target],
      ['unzip', '-d', target, file],
      `${inside}unzip -o ${file}`,
    ];
  }

  const list: (string[] | string)[] = tarFlags(name).flatMap((flag) => [
    ['tar', `-${flag}`, file, '-C', target],
    `${inside}tar -${flag} ${file}`,
  ]);
  // 同一写法只尝试一次
  const seen = new Set<string>();
  return list.filter((command) => {
    const key = String(command);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
