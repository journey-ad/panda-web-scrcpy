import type { FileEntry, PreviewKind, Thumb } from '../model/types';

/** 网格缩略图的来源，eligible 决定这个条目值不值得生成 */
export interface ThumbSource {
  eligible: (entry: FileEntry) => boolean;
  loader: (entry: FileEntry) => Promise<Thumb | null>;
}

/** 文件头规则，offset 缺省为 0 */
export interface MagicRule {
  bytes: number[];
  offset?: number;
  label: string;
}

/** 列表筛选用的大类 */
export type FileGroup = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'app' | 'other';

/**
 * 一种文件类型的全部声明
 * 只有认领的扩展名是必填，其余按需提供，用不到的能力不声明
 */
export interface FormatPlugin {
  /** 认领的扩展名 */
  exts: string[];
  /** 列表里显示的类型名，缺省按扩展名生成 */
  kind?: string;
  /** 列表筛选的大类，缺省由预览类型推出，压缩包这类没有预览的类型需要自己声明 */
  group?: FileGroup;
  /** 提供内置预览的类型才有 */
  preview?: PreviewKind;
  /** 预览体积上限，null 为不限，缺省 16MB */
  limit?: number | null;
  /** 按文本解码，预览标题栏可选编码 */
  textual?: boolean;
  /** 字号可调，HTML 由文档自身排版决定字号，不参与 */
  scalable?: boolean;
  /** 预览窗的上一个/下一个只在这些类型之间循环 */
  media?: boolean;
  /** 网格里的图标与配色 */
  icon?: string;
  color?: string;
  /** 渲染组件，路径写成字面量，构建期才能拆出独立代码块 */
  view?: () => Promise<unknown>;
  /** 网格缩略图 */
  thumb?: ThumbSource;
  /** 按文件头认出真实格式，供信息面板显示 */
  sniff?: (head: Uint8Array) => string | null;
  /** 扩展名判不出时，按文件头认领这个类型 */
  detect?: (head: Uint8Array) => boolean;
  /** 没有内置预览或体积超限时改用这个插件，目前只有信息面板 */
  fallback?: boolean;
}

/* ------------------------------- 登记入口 ------------------------------- */

const plugins: FormatPlugin[] = [];
const byExt = new Map<string, FormatPlugin>();
const byPreview = new Map<PreviewKind, FormatPlugin>();
let fallback: FormatPlugin | null = null;

/** 插件在模块求值时登记自己，返回原对象便于直接导出 */
export const definePlugin = (plugin: FormatPlugin): FormatPlugin => {
  plugins.push(plugin);
  for (const ext of plugin.exts) byExt.set(ext, plugin);
  if (plugin.preview) byPreview.set(plugin.preview, plugin);
  if (plugin.fallback) fallback = plugin;
  return plugin;
};

/** 一个目录里登记多个类型时使用 */
export const definePlugins = (list: FormatPlugin[]) => list.forEach((item) => definePlugin(item));

export const allPlugins = () => plugins;
export const byExtension = (ext: string) => byExt.get(ext);
export const byPreviewKind = (kind: PreviewKind) => byPreview.get(kind);
export const fallbackPlugin = () => fallback;

/* ------------------------------- 文件头 --------------------------------- */

/** 头部在指定偏移处是否为这组字节 */
export const hasBytes = (head: Uint8Array, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, index) => head[offset + index] === byte);

/** 按一组文件头规则生成 sniff，规则按顺序匹配，命中即返回 */
export const firstMatch =
  (rules: MagicRule[]) =>
  (head: Uint8Array): string | null =>
    rules.find((rule) => hasBytes(head, rule.bytes, rule.offset))?.label ?? null;
