/** 拼接目录与条目名 */
export const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`);

/** 取上一级路径 */
export const parentPath = (path: string) => {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
};

const pad = (value: number) => String(value).padStart(2, '0');

export const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
};

export const formatTime = (mtime: number) => {
  if (!mtime) return '—';
  const date = new Date(mtime);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 不能出现在文件与目录名称里的字符 */
const INVALID_NAME_CHARS = /[/\\:*?"<>|]/g;

/** 去掉名称里不能用的字符 */
export const filterNameChars = (value: string) => value.replace(INVALID_NAME_CHARS, '');

/** 名称拆成基名与扩展名；隐藏文件与没有扩展名的都整名当基名 */
const splitName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? { base: name, ext: '' } : { base: name.slice(0, dot), ext: name.slice(dot) };
};

/** 目标里已有同名时往后加序号，序号放在扩展名之前 */
export const uniqueName = (name: string, taken: Set<string>) => {
  if (!taken.has(name)) return name;
  const { base, ext } = splitName(name);
  let index = 1;
  while (taken.has(`${base} (${index})${ext}`)) index += 1;
  return `${base} (${index})${ext}`;
};
