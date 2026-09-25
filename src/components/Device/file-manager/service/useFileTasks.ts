import { saveAs } from 'file-saver';
import { nextTick, ref, type Ref } from 'vue';

import client from '../../../Scrcpy/adb-client';
import { createFileStream } from '../../../Scrcpy/file';

import { extractCommands } from '../format/archive/extract';
import { extractZipInBrowser } from '../format/archive/extract-browser';
import { createZip, type ZipWriter } from '../format/archive/zip-writer';
import { describeEntry } from '../format/registry';
import { mimeOf } from '../model/mime';
import { exec, readDir, readFile, withSync } from '../device/fs';
import { codeOf, DeviceError, failText } from '../model/errors';
import type { FileEntry, LocalFile } from '../model/types';
import { errorText, formatSize, joinPath } from '../shared/utils';

/** 有传输任务时新的操作一律拒绝 */
export const BUSY_HINT = '有传输任务正在进行，请等它结束后再操作';

export interface TaskProgress {
  title: string;
  name: string;
  value: number;
  detail: string;
  /** 弹窗底部的注意事项，各类任务的提示语不同 */
  hint: string;
  /** 批命令执行期间条数进度不可知，进度条按不确定态渲染 */
  indeterminate?: boolean;
}

/** 多文件时把"第几个"拼在进度里，单文件只说已传字节 */
const ordinal = (index: number, count: number) => (count > 1 ? `第 ${index + 1} / ${count} 项` : '');

/** 进度详情里"第几个"与字节数之间的分隔，单文件时不出现 */
const detailOf = (index: number, count: number, text: string) =>
  [ordinal(index, count), text].filter(Boolean).join(' · ');

/** 传输在浏览器与设备之间搬运数据，中断会留下不完整的文件 */
const TRANSFER_HINT = '传输期间请保持设备连接，不要关闭页面';

/** 删除、移动是在设备上直接执行的命令，与传输分开提示 */
const deviceHint = (verb: string) => `${verb}期间请保持设备连接，不要关闭页面`;

/** 一条命令能带的路径条数，命令行过长会被设备拒绝 */
const COMMAND_BATCH = 50;

/** 一批上传的文件数，一批一个 sync 会话 */
const UPLOAD_BATCH = 8;

/** 任务太快结束时进度会一闪而过，弹窗至少停留这么久，让满格的进度看得见 */
const MIN_VISIBLE = 400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 目录选择器来自 File System Access，lib.dom 尚未收录这部分类型 */
type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;

const directoryPicker = () =>
  (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

/**
 * 选一个本地目录，取消选择时返回 null，不支持时返回 undefined
 * 两种情况要分开：取消后只交付打包结果，不逐个保存
 */
const chooseDirectory = async (): Promise<FileSystemDirectoryHandle | null | undefined> => {
  const show = directoryPicker();
  if (!show) return undefined;
  try {
    return await show({ mode: 'readwrite' });
  } catch {
    return null;
  }
};

/** 把读取到的分片写入目录里的同名文件，已存在时覆盖 */
const writeInto = async (dir: FileSystemDirectoryHandle, name: string, chunks: Uint8Array[]) => {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob(chunks as BlobPart[], { type: mimeOf(name) }));
  await writable.close();
};

const pad = (value: number) => String(value).padStart(2, '0');

/** 单个条目按名字命名，多选时用时间戳，不用每次改名 */
const zipName = (list: FileEntry[]) => {
  if (list.length === 1) {
    const entry = list[0];
    const base = entry.isDirectory ? entry.name : entry.name.replace(/\.[^./]+$/, '');
    return `${base || entry.name}.zip`;
  }
  const now = new Date();
  return `打包-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
};

/** 相对路径里除文件名之外的各级目录 */
const parentDirs = (paths: string[]) => {
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      dirs.add(acc);
    }
  }
  return [...dirs];
};

/** 目录递归读出来压缩进压缩包，进度上显示的是当前处理的路径 */
const collect = async (zip: ZipWriter, entry: FileEntry, prefix: string, onName: (name: string) => void) => {
  const name = `${prefix}${entry.name}`;
  onName(name);
  if (entry.isDirectory) {
    await zip.add(`${name}/`, [], entry.mtime);
    for (const child of (await readDir(entry.path)).map(describeEntry)) {
      // 指向目录的链接按目录递归会绕回自身
      if (child.isLink && child.isDirectory) continue;
      await collect(zip, child, `${name}/`, onName);
    }
    return;
  }
  await zip.add(name, await readFile(entry.path), entry.mtime);
};

interface TaskOptions {
  /** 上传的落点 */
  currentPath: Ref<string>;
  /** 传输结束后刷新当前目录 */
  reload: () => Promise<unknown>;
  /** 删除与移动完成后直接更新列表 */
  onRemoved: (list: FileEntry[]) => void;
  notify: (text: string, type?: 'error' | 'success') => void;
}

interface RunOptions {
  /** 进度弹窗底部的提示语，未指定时按传输说明 */
  hint?: string;
  /** 完成后的收尾，未指定时重新读取当前目录 */
  settle?: (finished: FileEntry[]) => void;
  /** 一条命令处理的条目数，缺省逐条执行 */
  batch?: number;
}

/**
 * 文件传输：上传、下载、移动、删除，共用一个进度弹窗
 */
export const useFileTasks = (options: TaskOptions) => {
  const { currentPath, reload, onRemoved, notify } = options;
  const task = ref<TaskProgress | null>(null);

  const report = (patch: Partial<TaskProgress>) => {
    if (task.value) {
      Object.assign(task.value, patch);
    }
  };

  /** 按批执行设备命令，进度按条数推进；中途失败时已完成的部分仍然要反映到列表上 */
  const runEach = async (
    verb: string,
    list: FileEntry[],
    step: (group: FileEntry[]) => Promise<unknown>,
    run: RunOptions = {}
  ) => {
    const count = list.length;
    const size = Math.max(run.batch ?? 1, 1);
    const finished: FileEntry[] = [];
    const progress = () => (count > 1 ? `已完成 ${finished.length} / ${count} 项` : '');
    // 一批命令一次处理多个条目，名称固定用任务首个条目，条数用任务总数
    const batched = size > 1 && count > 1;
    const headline = batched ? `${list[0].name} 等 ${count} 项` : '';
    task.value = {
      title: `正在${verb}`,
      name: headline || list[0].name,
      value: 0,
      detail: count > 1 ? `共 ${count} 项` : '',
      hint: run.hint ?? TRANSFER_HINT,
      indeterminate: size > 1,
    };
    let failure: unknown = null;
    const startedAt = Date.now();
    try {
      for (let start = 0; start < count; start += size) {
        const group = list.slice(start, start + size);
        report({ name: headline || group[0].name, detail: progress() });
        await step(group);
        finished.push(...group);
        report({ value: finished.length / count, detail: progress() });
      }
    } catch (error) {
      failure = error;
    }
    try {
      if (run.settle) {
        run.settle(finished);
      } else if (!failure) {
        await reload();
      }
    } finally {
      // 先把进度填满再关窗口，弹窗关闭时已显示完成
      report({ value: failure ? finished.length / count : 1, detail: progress(), indeterminate: false });
      await nextTick();
      await wait(Math.max(0, MIN_VISIBLE - (Date.now() - startedAt)));
      task.value = null;
    }
    if (failure) {
      // 中途失败时已完成的部分已经生效，提示里要说清进度
      const done = finished.length ? `，已完成 ${finished.length} / ${count} 项` : '';
      notify(`${failText(verb, failure)}${done}`, 'error');
    } else {
      notify(`已${verb} ${finished.length} 项`);
    }
  };

  const download = async (list: FileEntry[]) => {
    const files = list.filter((entry) => !entry.isDirectory);
    if (!files.length) {
      notify('所选项里没有可下载的文件', 'error');
      return;
    }
    // 多个文件先选一个本地目录，逐个写入，比连开多次下载省事
    const dir = files.length > 1 ? await chooseDirectory() : undefined;
    if (dir === null) return;
    let saved = 0;
    try {
      for (const [index, file] of files.entries()) {
        const total = Math.max(file.size, 1);
        task.value = {
          title: '正在下载',
          name: file.name,
          value: 0,
          detail: detailOf(index, files.length, `0 B / ${formatSize(file.size)}`),
          hint: TRANSFER_HINT,
        };
        const chunks = await readFile(file.path, {
          onProgress: (read) => {
            report({
              value: files.length === 1 ? read / total : (index + read / total) / files.length,
              detail: detailOf(index, files.length, `${formatSize(read)} / ${formatSize(file.size)}`),
            });
          },
        });
        if (dir) await writeInto(dir, file.name, chunks);
        else saveAs(new Blob(chunks as BlobPart[], { type: mimeOf(file.name) }), file.name);
        saved += 1;
      }
      notify(`已下载 ${files.length} 个文件`);
    } catch (error) {
      // 中途失败时前面几个文件已经存到本机
      const done = saved ? `，已下载 ${saved} / ${files.length} 个文件` : '';
      notify(`${failText('下载', error)}${done}`, 'error');
    } finally {
      task.value = null;
    }
  };

  /** 上传前把缺的目录建出来，一批一条命令 */
  const makeDirectories = async (relative: string[]) => {
    const unique = [...new Set(relative)];
    for (let start = 0; start < unique.length; start += COMMAND_BATCH) {
      const group = unique.slice(start, start + COMMAND_BATCH).map((path) => joinPath(currentPath.value, path));
      await exec(['mkdir', '-p', ...group]);
    }
  };

  /** 分批上传到当前目录，一批一个 sync 会话；中途失败时已完成的部分仍然生效 */
  const upload = async (list: LocalFile[], dirs: string[] = []) => {
    if (!list.length && !dirs.length) return;
    const count = list.length;
    const total = list.reduce((sum, item) => sum + item.file.size, 0);
    let uploaded = 0;
    let finished = 0;
    task.value = {
      title: '正在上传',
      name: list[0]?.path ?? dirs[0],
      value: 0,
      detail: detailOf(0, count, `0 B / ${formatSize(total)}`),
      hint: TRANSFER_HINT,
    };
    let failure: unknown = null;
    try {
      await makeDirectories([...parentDirs(list.map((item) => item.path)), ...dirs]);
      for (let start = 0; start < count; start += UPLOAD_BATCH) {
        const group = list.slice(start, start + UPLOAD_BATCH);
        await withSync(async (sync) => {
          for (const [offset, item] of group.entries()) {
            report({
              name: item.path,
              detail: detailOf(start + offset, count, `${formatSize(uploaded)} / ${formatSize(total)}`),
            });
            await sync.write({
              filename: joinPath(currentPath.value, item.path),
              file: createFileStream(item.file),
              mtime: Math.floor(item.file.lastModified / 1000),
            });
            uploaded += item.file.size;
            finished += 1;
            report({
              value: total ? uploaded / total : 1,
              detail: detailOf(start + offset, count, `${formatSize(uploaded)} / ${formatSize(total)}`),
            });
          }
        });
      }
    } catch (error) {
      failure = error;
    }
    try {
      if (!failure) {
        notify(`已上传 ${finished} 个文件`);
        await reload();
      }
    } finally {
      task.value = null;
    }
    if (failure) {
      const done = finished ? `，已完成 ${finished} / ${count} 个文件` : '';
      notify(`${failText('上传', failure)}${done}`, 'error');
    }
  };

  /**
   * 移动：多个源一次 mv 进入目标目录，末尾的斜杠让它被识别为目录
   * 指定了目标名时逐条执行，一条命令只能有一个目标
   */
  const move = (list: FileEntry[], target: string, names?: Map<string, string>) => {
    // 源与目标同一处时设备会报 same file，这里直接跳过
    if (list.every((entry) => joinPath(target, entry.name) === entry.path)) return;
    return runEach(
      '移动',
      list,
      (group) =>
        exec(
          names
            ? ['mv', '-f', group[0].path, joinPath(target, names.get(group[0].path) ?? group[0].name)]
            : ['mv', '-f', ...group.map((entry) => entry.path), `${target}/`]
        ),
      {
        hint: deviceHint('移动'),
        batch: names ? 1 : COMMAND_BATCH,
        // 移到当前目录时新条目要出现，移到别处则源条目从列表里移除
        settle: target === currentPath.value ? undefined : onRemoved,
      }
    );
  };

  /** 复制到目标目录：命令走 cp -r，目录与文件同等对待 */
  const copy = (list: FileEntry[], target: string, names?: Map<string, string>) =>
    runEach(
      '复制',
      list,
      ([entry]) => exec(['cp', '-r', entry.path, joinPath(target, names?.get(entry.path) ?? entry.name)]),
      {
        hint: deviceHint('复制'),
        batch: 1,
        // 只有复制到当前目录才会改变当前列表
        settle: target === currentPath.value ? undefined : () => {},
      }
    );

  /** 命令输出可能有多行，取第一行非空的显示给用户 */
  const firstLine = (text: string) => text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';

  /**
   * 解压：优先交给设备上的 unzip / tar，ZIP 失败时退回浏览器内解压
   * 设备端 toybox unzip 对未置 UTF-8 标志位的中文文件名会报 Invalid entry name，
   * 浏览器内解压按归档内编码还原文件名后写回设备，但需把整个压缩包读回再写回，速度较慢
   * 走浏览器内解压前用 confirmFallback 向用户二次确认，不静默发起传输
   */
  const extract = async (
    entry: FileEntry,
    target: string,
    confirmFallback?: () => Promise<boolean>
  ) => {
    const isZip = /\.zip$/i.test(entry.name);
    const shell = client.device?.subprocess.shellProtocol;

    // 设备端解压先尝试，ZIP 与 tar 同等对待
    if (shell?.isSupported) {
      const attempts: string[] = [];
      for (const command of extractCommands(entry.name, entry.path, target)) {
        const result = await shell.spawnWaitText(command);
        if (result.exitCode === 0) {
          notify(`已解压 ${entry.name} 到当前目录`);
          await reload();
          return;
        }
        const output = firstLine((result.stderr || result.stdout).trim());
        if (output) attempts.push(output);
      }
      // 各写法都失败时用第一条命令的输出，它最接近真实的失败原因
      if (!isZip) throw new DeviceError('unknown', attempts[0] || '设备上找不到 unzip 或 tar 命令');
    } else if (!isZip) {
      throw new DeviceError('unsupported', '需要设备端 shell v2');
    }

    // 仅 ZIP 会走到这里：设备端解压失败后先征求确认，再在浏览器内按归档内编码解压
    if (confirmFallback && !(await confirmFallback())) return;

    task.value = {
      title: '正在解压',
      name: entry.name,
      value: 0,
      detail: '正在读取压缩包…',
      hint: '文件需要往返处理，解压速度可能较慢',
    };
    try {
      await extractZipInBrowser(entry.path, target, (value, detail) => report({ value, detail }));
    } catch (error) {
      task.value = null;
      // 内层错误带着设备侧的原因，把它的码一起透传
      throw new DeviceError(codeOf(error), `浏览器内解压失败：${errorText(error)}`);
    }
    report({ value: 1 });
    notify(`已解压 ${entry.name} 到当前目录`);
    await reload();
    task.value = null;
  };

  /**
   * 打包下载：目录与多选压成一个 ZIP 再交给浏览器保存
   * 打包在浏览器里做，设备只负责提供文件
   */
  const pack = async (list: FileEntry[]) => {
    if (!list.length) return;
    const zip = createZip();
    task.value = {
      title: '正在打包',
      name: list[0].name,
      value: 0,
      detail: list.length > 1 ? `共 ${list.length} 项` : '',
      hint: TRANSFER_HINT,
    };
    try {
      for (const [index, entry] of list.entries()) {
        await collect(zip, entry, '', (name) => report({ name }));
        report({
          value: (index + 1) / list.length,
          detail: list.length > 1 ? `已完成 ${index + 1} / ${list.length} 项` : '',
        });
      }
      saveAs(zip.blob(), zipName(list));
      notify(`已打包 ${list.length} 项`);
    } catch (error) {
      notify(`打包失败：${errorText(error)}`, 'error');
    } finally {
      task.value = null;
    }
  };

  /** 删除不可恢复，成功后直接从列表移除，列表随之更新 */
  const remove = (list: FileEntry[]) =>
    runEach('删除', list, (group) => exec(['rm', '-rf', ...group.map((entry) => entry.path)]), {
      hint: deviceHint('删除'),
      settle: onRemoved,
      batch: COMMAND_BATCH,
    });

  return { task, download, upload, move, copy, pack, remove, extract };
};
