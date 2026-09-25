import { defineAsyncComponent, h, type Component } from 'vue';

import { extensionOf } from '../model/mime';
import type { FileEntry, PreviewKind, RawEntry } from '../model/types';
import { allPlugins, byExtension, byPreviewKind, fallbackPlugin, type FileGroup, type ThumbSource } from './plugin';

/** 未声明上限的类型都按完整载入内存处理 */
const DEFAULT_LIMIT = 16 * 1024 * 1024;

/** format 下每个子目录的 index.ts 都是一个插件，新增类型只要建目录，无需改动别处 */
import.meta.glob('./*/index.ts', { eager: true });

/* ------------------------------- 查询接口 ------------------------------ */

/** 设备给出的原始条目补上类型与预览，目录不参与 */
export const describeEntry = (raw: RawEntry): FileEntry => {
  if (raw.isDirectory) return { ...raw, kind: '目录', preview: null };
  const ext = extensionOf(raw.name);
  const plugin = byExtension(ext);
  return {
    ...raw,
    kind: plugin?.kind ?? (ext ? `${ext.toUpperCase()} 文件` : '文件'),
    preview: plugin?.preview ?? null,
  };
};

/** 预览类型由扩展名决定，判断不出时让各插件按文件头认领 */
export const resolvePreview = (name: string, head?: Uint8Array | null): PreviewKind | null => {
  const known = byExtension(extensionOf(name))?.preview;
  if (known) return known;
  if (!head) return null;
  return allPlugins().find((plugin) => plugin.preview && plugin.detect?.(head))?.preview ?? null;
};

/** 声明为 null 的类型不限体积，未声明的才按完整载入处理 */
export const previewLimit = (kind: PreviewKind): number | null => {
  const limit = byPreviewKind(kind)?.limit;
  return limit === undefined ? DEFAULT_LIMIT : limit;
};

export const withinLimit = (kind: PreviewKind, size: number) => {
  const limit = previewLimit(kind);
  return limit === null || size <= limit;
};

export const isTextual = (kind: PreviewKind) => !!byPreviewKind(kind)?.textual;
export const isScalable = (kind: PreviewKind) => !!byPreviewKind(kind)?.scalable;
export const isMedia = (kind: PreviewKind) => !!byPreviewKind(kind)?.media;

/** 按文件头识别真实格式 */
export const sniffFormat = (head: Uint8Array): string | null => {
  for (const plugin of allPlugins()) {
    const label = plugin.sniff?.(head);
    if (label) return label;
  }
  return null;
};

/** 文件头认出的格式里，第一个带内置预览的类型，供信息面板切换 */
export const previewOfHead = (head: Uint8Array): PreviewKind | null =>
  allPlugins().find((plugin) => plugin.preview && plugin.sniff?.(head))?.preview ?? null;

export const thumbOf = (entry: FileEntry): ThumbSource | undefined =>
  entry.preview ? byPreviewKind(entry.preview)?.thumb : undefined;

/** 有预览的类型按预览取图标，其余按扩展名取 */
const metaOf = (entry: FileEntry) =>
  (entry.preview ? byPreviewKind(entry.preview) : undefined) ?? byExtension(extensionOf(entry.name));

export const iconOf = (entry: FileEntry) => metaOf(entry)?.icon;
export const colorOf = (entry: FileEntry) => metaOf(entry)?.color;

/** 预览类型到大类的对应，未列出的类型归到其他 */
const GROUP_OF_PREVIEW: Partial<Record<PreviewKind, FileGroup>> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'document',
  code: 'document',
  markdown: 'document',
  html: 'document',
  json: 'document',
  csv: 'document',
  pdf: 'document',
  docx: 'document',
  xlsx: 'document',
  pptx: 'document',
  font: 'document',
  sqlite: 'document',
  epub: 'document',
  mobi: 'document',
  apk: 'app',
};

/** 列表按类型筛选时用的大类 */
export const groupOf = (entry: FileEntry): FileGroup => {
  const plugin = metaOf(entry);
  if (plugin?.group) return plugin.group;
  return entry.preview ? GROUP_OF_PREVIEW[entry.preview] ?? 'other' : 'other';
};

/* ------------------------------- 渲染组件 ------------------------------ */

const Pending = () => h('div', { class: 'preview-hint' }, '正在加载…');

const asyncView = (loader: () => Promise<unknown>) =>
  defineAsyncComponent({
    loader: loader as () => Promise<Component>,
    loadingComponent: Pending,
    errorComponent: () => h('div', { class: 'preview-hint' }, '预览组件加载失败'),
    delay: 120,
  });

const cache = new Map<PreviewKind | null, Component>();

/** 组件由插件自带，没有内置预览或体积超限时改用默认插件的面板 */
export const viewOf = (kind: PreviewKind | null): Component => {
  const cached = cache.get(kind);
  if (cached) return cached;
  const loader = (kind ? byPreviewKind(kind)?.view : null) ?? fallbackPlugin()?.view;
  const component = loader ? asyncView(loader) : Pending;
  cache.set(kind, component);
  return component;
};
