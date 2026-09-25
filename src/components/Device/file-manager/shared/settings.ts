import { inject, provide, reactive, watch, type InjectionKey } from 'vue';

/** 文件管理器的界面偏好统一存在这一个 key 里 */
const KEY = 'panda:file-manager:setting';

/** 网格列数范围 */
export const GRID_MIN_COLS = 2;
export const GRID_MAX_COLS = 8;

/** 文本类预览可选的字号 */
export const TEXT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];
const TEXT_SIZE_DEFAULT = 12;

export type ViewMode = 'list' | 'grid';
export type SortKey = 'name' | 'mtime' | 'size';
export const SORT_KEYS: SortKey[] = ['name', 'mtime', 'size'];

export interface Settings {
  viewMode: ViewMode;
  gridCols: number;
  /** 网格里每个项目是否描边 */
  gridShowBorder: boolean;
  /** 网格里是否生成图片、视频与安装包的缩略图，关掉后统一显示类型图标 */
  gridShowThumbnails: boolean;
  /** 列表里是否显示行间分隔线 */
  listShowDivider: boolean;
  /** 列表里名称下方是否显示类型、大小与修改时间 */
  listShowMeta: boolean;
  /** 是否列出以点开头的隐藏文件与目录 */
  showHidden: boolean;
  /** 收藏的目录，按收藏顺序排列 */
  bookmarks: string[];
  sortKey: SortKey;
  sortAsc: boolean;
  /** 预览弹窗是否全屏，小窗尺寸所有类型共用 */
  previewFullscreen: boolean;
  /** 文本类预览的字号，文本/JSON/Markdown/表格/代码共用 */
  textFontSize: number;
  /** 拖拽移动前是否弹二次确认，取消勾选后直接执行 */
  confirmMove: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  viewMode: 'list',
  gridCols: 4,
  gridShowBorder: true,
  gridShowThumbnails: true,
  listShowDivider: true,
  listShowMeta: true,
  showHidden: false,
  bookmarks: [],
  sortKey: 'name',
  sortAsc: true,
  previewFullscreen: true,
  textFontSize: TEXT_SIZE_DEFAULT,
  confirmMove: true,
};

const clampCols = (value: number) => {
  const cols = Math.round(value) || DEFAULT_SETTINGS.gridCols;
  return Math.min(GRID_MAX_COLS, Math.max(GRID_MIN_COLS, cols));
};

const clampTextSize = (value: number) => {
  return TEXT_SIZES.includes(value) ? value : TEXT_SIZE_DEFAULT;
};

/** 存过的偏好以默认值为底合并，只有两个枚举字段需要校验取值 */
const normalize = (saved: Partial<Settings>): Settings => {
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  return {
    ...merged,
    viewMode: merged.viewMode === 'grid' ? 'grid' : 'list',
    sortKey: SORT_KEYS.includes(merged.sortKey) ? merged.sortKey : 'name',
    gridCols: clampCols(merged.gridCols),
    textFontSize: clampTextSize(merged.textFontSize),
    bookmarks: Array.isArray(merged.bookmarks)
      ? merged.bookmarks.filter((item) => typeof item === 'string')
      : [],
  };
};

const load = (): Settings => {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? (JSON.parse(raw) as Partial<Settings>) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const settings = reactive(load());

const SETTINGS_KEY: InjectionKey<Settings> = Symbol('file-manager-settings');

/** 在文件管理器的根组件上调用一次，其余组件经 useSettings 取 */
export const provideSettings = () => provide(SETTINGS_KEY, settings);

/** 组件内读取界面偏好；提供方在自己的 setup 里无法注入，退回同一份单例 */
export const useSettings = () => inject(SETTINGS_KEY, settings);

watch(settings, () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下无法写入，忽略 */
  }
});

/** 外观面板的「恢复默认」：逐项写回默认值，改动同样由上面的侦听落盘 */
export const resetSettings = () => {
  // 收藏是用户数据，不随外观设置一起重置
  Object.assign(settings, DEFAULT_SETTINGS, { bookmarks: settings.bookmarks });
};
