import { computed, onScopeDispose, ref, shallowRef, toRef, watch } from 'vue';

import client from '../../../Scrcpy/adb-client';
import { readDir } from '../device/fs';
import { describeEntry, groupOf } from '../format/registry';
import type { FileGroup } from '../format/plugin';
import type { SortKey } from '../shared/settings';
import { useSettings } from '../shared/settings';
import type { FileEntry, RawEntry } from '../model/types';
import { errorText, joinPath, parentPath } from '../shared/utils';

/** 主目录，初始路径与"回到主目录"都用它 */
export const HOME_PATH = '/sdcard';

/** 列表的类型筛选取值，all 为不筛 */
export type FileFilter = 'all' | FileGroup;

/** 搜索框输入后延迟过滤，大目录里逐字重排代价太高 */
const SEARCH_DEBOUNCE = 200;

/** 名称比较统一用一个实例，逐次新建比较器的开销比比较本身还大 */
const compareName = new Intl.Collator('zh-Hans-CN', { numeric: true }).compare;

interface DirectoryOptions {
  notify: (text: string, type?: 'error' | 'success') => void;
  /** 每次开始读取目录前的收尾，例如清空选区与关闭右键菜单 */
  onBeforeLoad: () => void;
}

/**
 * 目录浏览：当前路径、条目、加载态、搜索词与排序
 * 导航、刷新与跳转校验都在这里，组件只把状态渲染出来
 */
export const useDirectory = (options: DirectoryOptions) => {
  const currentPath = ref(HOME_PATH);
  /* 目录条目整体替换，浅引用只包一层 */
  const entries = shallowRef<FileEntry[]>([]);
  const loading = ref(false);
  /** 搜索框的即时值，绑定输入框 */
  const searchInput = ref('');
  /** 防抖后的搜索词，过滤用它 */
  const search = ref('');
  /* 排序偏好存在注入的界面偏好里 */
  const prefs = useSettings();
  const sortKey = toRef(prefs, 'sortKey');
  const sortAsc = toRef(prefs, 'sortAsc');
  /** 类型筛选只作用于本次浏览，不进偏好 */
  const fileFilter = ref<FileFilter>('all');

  let searchTimer = 0;
  watch(searchInput, (value) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search.value = value;
    }, SEARCH_DEBOUNCE);
  });
  onScopeDispose(() => clearTimeout(searchTimer));

  const clearSearch = () => {
    clearTimeout(searchTimer);
    searchInput.value = '';
    search.value = '';
  };

  /** 读取的序号，乱序返回时只有最后发起的那一次生效 */
  let loadSeq = 0;

  /** 浏览过的路径与当前位置，前进后退在它上面移动 */
  const history = ref<string[]>([HOME_PATH]);
  const historyAt = ref(0);

  const canGoBack = computed(() => historyAt.value > 0);
  const canGoForward = computed(() => historyAt.value < history.value.length - 1);

  /** 落在新路径时追加一条，游标之后的部分丢弃 */
  const remember = (path: string) => {
    if (history.value[historyAt.value] === path) return;
    history.value = [...history.value.slice(0, historyAt.value + 1), path];
    historyAt.value = history.value.length - 1;
  };

  const load = async (path = currentPath.value, record = true) => {
    if (!client.device) {
      entries.value = [];
      return false;
    }
    const seq = (loadSeq += 1);
    loading.value = true;
    options.onBeforeLoad();
    try {
      const list = (await readDir(path)).map(describeEntry);
      if (seq !== loadSeq) return false;
      entries.value = list;
      currentPath.value = path;
      if (record) remember(path);
      return true;
    } catch (error) {
      if (seq !== loadSeq) return false;
      options.notify(`无法打开该目录：${errorText(error)}`, 'error');
      return false;
    } finally {
      if (seq === loadSeq) loading.value = false;
    }
  };

  /** 后退与前进只移动游标，落位成功才改 */
  const goBack = async () => {
    const target = historyAt.value - 1;
    if (target < 0) return;
    if (await load(history.value[target], false)) historyAt.value = target;
  };

  const goForward = async () => {
    const target = historyAt.value + 1;
    if (target >= history.value.length) return;
    if (await load(history.value[target], false)) historyAt.value = target;
  };

  const navigate = (path: string) => {
    if (path !== currentPath.value) {
      load(path);
    }
  };

  const openDirectory = (entry: FileEntry) => {
    // 从搜索结果里进入目录后清掉搜索词，新目录不被上一次的关键字过滤
    clearSearch();
    load(entry.path);
  };

  const goUp = () => navigate(parentPath(currentPath.value));
  const goHome = () => navigate(HOME_PATH);

  const breadcrumbs = computed(() => {
    const items: { name: string; path: string }[] = [];
    let acc = '';
    for (const part of currentPath.value.split('/').filter(Boolean)) {
      acc += `/${part}`;
      items.push({ name: part, path: acc });
    }
    // 根目录本身没有上级，单独显示一个占位项
    return items.length ? items : [{ name: '/', path: '/' }];
  });

  const visibleEntries = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    /* 目录不参与筛选，过滤过的目录仍可正常退出 */
    const filter = fileFilter.value;
    const list = entries.value.filter((entry) => {
      if (!prefs.showHidden && entry.name.startsWith('.')) return false;
      if (entry.isDirectory || filter === 'all') return true;
      return groupOf(entry) === filter;
    }).filter((entry) => !keyword || entry.name.toLowerCase().includes(keyword));
    const direction = sortAsc.value ? 1 : -1;
    // 主序按排序键，同值时回退到名称，顺序稳定
    return [...list].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      // 目录占用的大小是块大小，排序没有意义，仍按名称
      if (sortKey.value === 'size' && !a.isDirectory) {
        return (a.size - b.size) * direction || compareName(a.name, b.name);
      }
      if (sortKey.value === 'mtime') {
        return (a.mtime - b.mtime) * direction || compareName(a.name, b.name);
      }
      return compareName(a.name, b.name) * direction;
    });
  });

  /** 条目被隐藏或过滤掉的数量，用于区分空目录与筛选结果为空 */
  const filtered = computed(() => entries.value.length > visibleEntries.value.length);

  const setSort = (key: SortKey) => {
    if (sortKey.value === key) {
      sortAsc.value = !sortAsc.value;
    } else {
      sortKey.value = key;
      sortAsc.value = true;
    }
  };

  /** 删除成功后直接从列表移除，列表随之更新 */
  const removeEntries = (list: FileEntry[]) => {
    const removed = new Set(list.map((entry) => entry.path));
    entries.value = entries.value.filter((entry) => !removed.has(entry.path));
  };

  /** 条目在列表里的原始字段，重算类型时用它构造 */
  const rawOf = (entry: FileEntry): RawEntry => ({
    name: entry.name,
    path: entry.path,
    isDirectory: entry.isDirectory,
    isLink: entry.isLink,
    size: entry.size,
    mtime: entry.mtime,
  });

  /** 新建目录后直接插入列表，名称与类型判定与读取目录时一致 */
  const addDirectory = (name: string) => {
    const path = joinPath(currentPath.value, name);
    const added = describeEntry({ name, path, isDirectory: true, isLink: false, size: 0, mtime: Date.now() });
    // 同名目录已存在时只保留一条
    entries.value = [...entries.value.filter((entry) => entry.path !== path), added];
  };

  /** 重命名后直接替换该条目，类型与预览按新名称重判 */
  const renameEntry = (entry: FileEntry, name: string) => {
    const path = joinPath(parentPath(entry.path), name);
    const renamed = describeEntry({ ...rawOf(entry), name, path });
    entries.value = entries.value.map((item) => (item.path === entry.path ? renamed : item));
  };

  return {
    currentPath,
    entries,
    loading,
    searchInput,
    search,
    sortKey,
    sortAsc,
    fileFilter,
    filtered,
    visibleEntries,
    breadcrumbs,
    canGoBack,
    canGoForward,
    load,
    navigate,
    openDirectory,
    goUp,
    goHome,
    goBack,
    goForward,
    setSort,
    removeEntries,
    addDirectory,
    renameEntry,
  };
};
