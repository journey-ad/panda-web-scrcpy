export type PreviewKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'code'
  | 'markdown'
  | 'html'
  | 'json'
  | 'csv'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'font'
  | 'sqlite'
  | 'apk'
  | 'epub'
  | 'mobi';

/** 交给 @vue-office 渲染的类型 */
export type OfficeKind = Extract<PreviewKind, 'pdf' | 'docx' | 'xlsx' | 'pptx'>;

/** 设备读目录给出的原始条目，不含按格式判出的类型信息 */
export interface RawEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isLink: boolean;
  size: number;
  mtime: number;
}

/** 列表使用的条目，kind 与 preview 由格式层补齐 */
export interface FileEntry extends RawEntry {
  kind: string;
  preview: PreviewKind | null;
}

/** 待上传的本机文件，path 是相对本次拖入或选择的路径 */
export interface LocalFile {
  file: File;
  path: string;
}

/** 网格缩略图的结果，安装包还会带回来一个应用名 */
export interface Thumb {
  /** 缩放后的图，对象地址与本地存储都由缩略图缓存管理 */
  blob?: Blob;
  label?: string;
}

export interface ContextAction {
  title: string;
  icon: string;
  color?: string;
  /** 与上一条菜单项之间插入分隔线 */
  divider?: boolean;
  run: () => void;
}

/** 目录侧栏的一项，txt 的章节识别与电子书自带目录共用 */
export interface OutlineItem {
  title: string;
  /** 缩进层级，电子书的嵌套目录用得上 */
  level: number;
}
