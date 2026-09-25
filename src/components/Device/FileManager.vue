<script setup lang="ts">
import { mdiAlertOutline, mdiArchiveArrowDownOutline, mdiArrowDown, mdiArrowLeft, mdiArrowRight, mdiArrowUp, mdiCheckboxMultipleOutline, mdiClockOutline, mdiClose, mdiContentCopy, mdiContentCut, mdiContentPaste, mdiDeleteOutline, mdiDownload, mdiEyeOutline, mdiFileMoveOutline, mdiFingerprint, mdiFolderPlusOutline, mdiFolderSearchOutline, mdiFolderUploadOutline, mdiHomeOutline, mdiInformationOutline, mdiMagnify, mdiPaletteOutline, mdiPencilOutline, mdiRefresh, mdiSelectAll, mdiSelectionRemove, mdiSort, mdiSortAlphabeticalAscending, mdiSortNumericAscending, mdiUpload, mdiViewGridOutline, mdiViewListOutline, mdiZipBoxOutline } from '@mdi/js'

import { computed, onMounted, onUnmounted, ref, shallowRef, toRef } from 'vue';
import client from '../Scrcpy/adb-client';

import AppearanceDialog from './file-manager/ui/AppearanceDialog.vue';
import { isExtractableArchive } from './file-manager/format/archive/extract';
import ChecksumDialog from './file-manager/ui/ChecksumDialog.vue';
import ExtractDialog from './file-manager/ui/ExtractDialog.vue';
import FileBrowser from './file-manager/ui/FileBrowser.vue';
import FilterMenu from './file-manager/ui/FilterMenu.vue';
import MoveDialog from './file-manager/ui/MoveDialog.vue';
import PlacesMenu from './file-manager/ui/PlacesMenu.vue';
import PreviewDialog from './file-manager/ui/preview/PreviewDialog.vue';
import SearchDialog from './file-manager/ui/SearchDialog.vue';
import { describeEntry } from './file-manager/format/registry';
import { readDir } from './file-manager/device/fs';
import { provideSettings, useSettings } from './file-manager/shared/settings';
import type { ContextAction, FileEntry } from './file-manager/model/types';
import { useClipboard } from './file-manager/service/useClipboard';
import { useDirectory } from './file-manager/service/useDirectory';
import { useExtractFlow } from './file-manager/service/useExtractFlow';
import { useFileCommands } from './file-manager/service/useFileCommands';
import { BUSY_HINT, useFileTasks } from './file-manager/service/useFileTasks';
import { useFileDrop } from './file-manager/interaction/useFileDrop';
import { usePathBar } from './file-manager/interaction/usePathBar';
import { useShortcuts } from './file-manager/interaction/useShortcuts';
import { errorText, parentPath } from './file-manager/shared/utils';

provideSettings();
const prefs = useSettings();
/* 视图偏好统一存在 prefs 里 */
const viewMode = toRef(prefs, 'viewMode');
const message = ref('');
const messageType = ref<'error' | 'success'>('success');
const showMessage = ref(false);

/** 选区由工具栏与列表共用 */
const selectedPaths = shallowRef<string[]>([]);
const multiSelectMode = ref(false);
const browser = ref<InstanceType<typeof FileBrowser> | null>(null);

const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);

/** 移动 */
const moveDialog = ref(false);
const moveEntries = ref<FileEntry[]>([]);

/** 拖拽移动的二次确认，勾选后偏好写入 settings，之后的拖拽直接执行 */
const dragMoveDialog = ref(false);
const dragMoveEntries = ref<FileEntry[]>([]);
const dragMoveTarget = ref('');
const noConfirmAgain = ref(false);

/** 删除 */
const deleteDialog = ref(false);
const deleteEntries = ref<FileEntry[]>([]);

/** 预览 */
const previewDialog = ref(false);
const previewEntry = ref<FileEntry | null>(null);

/** 外观设置 */
const appearanceDialog = ref(false);

/** 校验和 */
const checksumDialog = ref(false);
const checksumEntry = ref<FileEntry | null>(null);

/** 在设备上搜索 */
const searchDialog = ref(false);

const notify = (text: string, type: 'error' | 'success' = 'success') => {
  messageType.value = type;
  message.value = text;
  showMessage.value = true;
};

/* ------------------------------- 目录浏览 ------------------------------- */

/** 右键菜单：条目与列表空白处共用一套容器，只有菜单项不同 */
const contextMenu = ref({ show: false, x: 0, y: 0, actions: [] as ContextAction[] });

const closeContextMenu = () => {
  contextMenu.value = { show: false, x: 0, y: 0, actions: [] };
};

/* 选择动作由列表提供：全选与反选都要按当前可见顺序和框选锚点重算 */
const setSelection = (paths: string[]) => browser.value?.setSelection(paths);
const selectAll = () => browser.value?.selectAll();
const invertSelection = () => browser.value?.invertSelection();
const clearSelected = () => browser.value?.clearSelected();
const clearSelection = () => browser.value?.clearSelection();

/**
 * 目录状态与导航交给 useDirectory，这里只留下编排与界面
 * 读取目录前先清掉选区与右键菜单
 */
const {
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
} = useDirectory({
  notify,
  onBeforeLoad: () => {
    clearSelection();
    closeContextMenu();
  },
});

/* 地址栏与文件命令只依赖目录状态，实例化放在 useDirectory 之后 */

const {
  editingPath,
  pathInput,
  pathField,
  submitPath,
  onCrumbClick,
  onCrumbAreaClick,
  onOutsideMouseDown,
} = usePathBar({ currentPath, breadcrumbs, navigate, notify });

const {
  mkdirDialog,
  mkdirName,
  mkdirError,
  renameDialog,
  renameName,
  renameTarget,
  renameError,
  setMkdirName,
  setRenameName,
  clearNameError,
  openMkdirDialog,
  openRename,
  confirmMkdir,
  confirmRename,
} = useFileCommands({ currentPath, addDirectory, replaceEntry: renameEntry, notify });

/* 选区可能上千项，判定统一用集合查找 */
const selectedSet = computed(() => new Set(selectedPaths.value));

const selectedEntries = computed(() =>
  entries.value.filter((entry) => selectedSet.value.has(entry.path))
);

const selectedFiles = computed(() => selectedEntries.value.filter((entry) => !entry.isDirectory));

const allVisibleSelected = computed(
  () =>
    visibleEntries.value.length > 0 &&
    visibleEntries.value.every((entry) => selectedSet.value.has(entry.path))
);

const toggleView = () => {
  viewMode.value = viewMode.value === 'list' ? 'grid' : 'list';
};

/* ------------------------------- 传输任务 ------------------------------- */

/** 删除成功后不再重新读取目录，条目从目录里移除，选区同步清掉 */
const onRemoved = (list: FileEntry[]) => {
  const removed = new Set(list.map((entry) => entry.path));
  selectedPaths.value = selectedPaths.value.filter((path) => !removed.has(path));
  removeEntries(list);
};

const { task, download, upload, move, copy, pack, remove, extract } = useFileTasks({
  currentPath,
  reload: () => load(),
  onRemoved,
  notify,
});

/** 剪贴板：复制与剪切跨目录进行，粘贴时才落到设备上 */
const clipboard = useClipboard({
  copy,
  move,
  currentPath,
  hasTask: () => !!task.value,
  notify,
});

/** 解压：确认弹窗与二次确认都在这里，命令仍走 useFileTasks */
const {
  dialog: extractDialog,
  entry: extractEntry,
  busy: extractBusy,
  fallback: extractFallback,
  ask: askExtract,
  confirm: confirmExtract,
  resolveFallback: resolveExtractFallback,
} = useExtractFlow({
  currentPath,
  hasTask: () => !!task.value,
  extract,
  notify,
});

const { dragging, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop({
  canDrop: () => !!client.device,
  onFiles: ({ files, dirs }) => {
    if (!client.device) {
      notify('设备未连接，请连接后再操作', 'error');
      return;
    }
    if (task.value) {
      notify(BUSY_HINT, 'error');
      return;
    }
    if (!files.length && !dirs.length) {
      notify('拖入的内容里没有可上传的文件', 'error');
      return;
    }
    upload(files, dirs);
  },
});

/** 拖到目录上松开：确认后整批移过去，确认过就不再询问 */
const dropOnDirectory = (list: FileEntry[], target: string) => {
  if (task.value) {
    notify(BUSY_HINT, 'error');
    return;
  }
  if (!prefs.confirmMove) {
    move(list, target);
    return;
  }
  dragMoveEntries.value = list;
  dragMoveTarget.value = target;
  noConfirmAgain.value = false;
  dragMoveDialog.value = true;
};

const pickUpload = () => fileInput.value?.click();

/** 选目录靠 webkitdirectory，不支持的浏览器只能拖进来 */
const pickUploadFolder = () => {
  if (!('webkitdirectory' in document.createElement('input'))) {
    notify('当前浏览器不支持选择目录，可以把目录直接拖进来', 'error');
    return;
  }
  folderInput.value?.click();
};

/** 文件与目录两个输入共用一个处理 */
const handleUploadSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const list = Array.from(target.files ?? []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
  target.value = '';
  if (list.length) {
    upload(list);
  }
};

/* ------------------------------- 右键菜单 ------------------------------- */

const CONTEXT_WIDTH = 180;
const CONTEXT_ITEM_HEIGHT = 34;
const CONTEXT_PADDING = 6;
const CONTEXT_DIVIDER_HEIGHT = 9;

/** 危险操作与设置类操作各自用一条分割线隔开 */
const needsDivider = (action: ContextAction, index: number) =>
  index > 0 && (action.divider === true || action.color === 'error');

const openMenu = (actions: ContextAction[], event: MouseEvent) => {
  const dividers = actions.filter((action, index) => needsDivider(action, index)).length;
  const height = actions.length * CONTEXT_ITEM_HEIGHT + CONTEXT_PADDING * 2 +
    dividers * CONTEXT_DIVIDER_HEIGHT;
  contextMenu.value = {
    show: true,
    actions,
    x: Math.max(4, Math.min(event.clientX, window.innerWidth - CONTEXT_WIDTH - 4)),
    y: Math.max(4, Math.min(event.clientY, window.innerHeight - height - 4)),
  };
};

/** 条目菜单，作用对象是当前选区 */
const entryActions = (list: FileEntry[]): ContextAction[] => {
  if (!list.length) return [];
  const actions: ContextAction[] = [];
  const single = list.length === 1 ? list[0] : null;
  if (single && !single.isDirectory) {
    actions.push({
      title: single.preview ? '预览' : '文件信息',
      icon: single.preview ? mdiEyeOutline : mdiInformationOutline,
      run: () => openPreview(single),
    });
  }
  if (single && isExtractableArchive(single.name)) {
    actions.push({ title: '解压', icon: mdiArchiveArrowDownOutline, run: () => askExtract(single) });
  }
  if (list.some((entry) => !entry.isDirectory)) {
    actions.push({
      title: list.length > 1 ? `下载（${list.length} 项）` : '下载',
      icon: mdiDownload,
      run: () => download(list),
    });
  }
  // 单个文件直接下载即可，只有目录或多选才需要先打包
  if (list.length > 1 || list[0].isDirectory) {
    actions.push({ title: '打包下载', icon: mdiZipBoxOutline, run: () => pack(list) });
  }
  if (single && !single.isDirectory) {
    actions.push({ title: '校验和', icon: mdiFingerprint, run: () => openChecksum(single) });
  }
  actions.push({ title: '复制', icon: mdiContentCopy, divider: true, run: () => clipboard.copy(list) });
  actions.push({ title: '剪切', icon: mdiContentCut, run: () => clipboard.cut(list) });
  if (single?.isDirectory && clipboard.filled.value) {
    actions.push({
      title: `粘贴到「${single.name}」`,
      icon: mdiContentPaste,
      run: () => clipboard.paste(single.path),
    });
  }
  if (single) {
    actions.push({ title: '重命名', icon: mdiPencilOutline, run: () => openRename(single) });
  }
  actions.push({ title: '移动到…', icon: mdiFileMoveOutline, run: () => openMove(list) });
  actions.push({
    title: list.length > 1 ? `删除（${list.length} 项）` : '删除',
    icon: mdiDeleteOutline,
    color: 'error',
    run: () => askDelete(list),
  });
  return actions;
};

const openContextMenu = (entry: FileEntry, event: MouseEvent) => {
  if (!selectedSet.value.has(entry.path)) {
    setSelection([entry.path]);
    multiSelectMode.value = false;
  }
  openMenu(entryActions(selectedEntries.value), event);
};

/** 空白处菜单，作用对象是当前目录 */
const openBlankMenu = (event: MouseEvent) => {
  openMenu(
    [
      { title: '新建目录', icon: mdiFolderPlusOutline, run: openMkdirDialog },
      { title: '上传文件', icon: mdiUpload, run: pickUpload },
      { title: '上传目录', icon: mdiFolderUploadOutline, run: pickUploadFolder },
      ...(clipboard.filled.value
        ? [
            {
              title: `粘贴（${clipboard.count.value} 项）`,
              icon: mdiContentPaste,
              divider: true,
              run: () => clipboard.pasteIntoCurrent(),
            },
          ]
        : []),
      { title: '刷新', icon: mdiRefresh, divider: true, run: () => load() },
      { title: '全选', icon: mdiSelectAll, run: selectAll },
      { title: '外观设置', icon: mdiPaletteOutline, divider: true, run: () => (appearanceDialog.value = true) },
    ],
    event
  );
};

const runContextAction = (action: ContextAction) => {
  closeContextMenu();
  action.run();
};

const dialogOpen = computed(
  () =>
    mkdirDialog.value ||
    renameDialog.value ||
    moveDialog.value ||
    dragMoveDialog.value ||
    deleteDialog.value ||
    extractDialog.value ||
    previewDialog.value ||
    appearanceDialog.value ||
    checksumDialog.value ||
    searchDialog.value ||
    !!task.value
);

const rootRef = ref<HTMLElement | null>(null);

/* ------------------------------- 预览与文件操作 ------------------------------- */

const openPreview = (entry: FileEntry) => {
  // 预览组件与体积上限的判断都在弹窗里做，超限或没有内容预览时展示文件信息
  previewEntry.value = entry;
  previewDialog.value = true;
};

const openChecksum = (entry: FileEntry) => {
  checksumEntry.value = entry;
  checksumDialog.value = true;
};

/** 搜索结果只给路径：进到它所在的目录再选中它 */
const openFound = async (entry: FileEntry) => {
  await load(parentPath(entry.path));
  setSelection([entry.path]);
};

/** 搜索只给路径，预览与下载前回所在目录取一次完整条目 */
const withFoundEntry = async (entry: FileEntry, run: (found: FileEntry) => void) => {
  try {
    const raw = (await readDir(parentPath(entry.path))).find((item) => item.name === entry.name);
    if (!raw) {
      notify('文件已不存在', 'error');
      return;
    }
    run(describeEntry(raw));
  } catch (error) {
    notify(`无法读取该文件：${errorText(error)}`, 'error');
  }
};

const previewFound = (entry: FileEntry) => withFoundEntry(entry, openPreview);

const downloadFound = (entry: FileEntry) => withFoundEntry(entry, (found) => download([found]));

/** 预览窗口右上角的下载按钮 */
const downloadEntry = (entry: FileEntry) => download([entry]);

const openMove = (list: FileEntry[]) => {
  if (!list.length) return;
  moveEntries.value = list;
  moveDialog.value = true;
};

const confirmMove = (target: string) => {
  moveDialog.value = false;
  move(moveEntries.value, target);
};

/** 拖拽放下后的确认，勾了"不再确认"就把偏好写进 settings */
const confirmDragMove = () => {
  dragMoveDialog.value = false;
  if (noConfirmAgain.value) {
    prefs.confirmMove = false;
  }
  move(dragMoveEntries.value, dragMoveTarget.value);
};

const askDelete = (list: FileEntry[]) => {
  deleteEntries.value = list;
  deleteDialog.value = true;
};

const confirmDelete = () => {
  deleteDialog.value = false;
  multiSelectMode.value = false;
  remove(deleteEntries.value);
};

/** 解压到当前目录的确认弹窗与二次确认都由 useExtractFlow 管 */

/** 快捷键要引用上面的动作，实例化放在最后 */
const { onKeyDown, onKeyUp, onBlur } = useShortcuts({
  root: rootRef,
  blocked: () => dialogOpen.value,
  closeMenu: () => {
    if (!contextMenu.value.show) return false;
    closeContextMenu();
    return true;
  },
  multiSelectMode,
  clearSelection,
  selectedEntries,
  selectAll,
  askDelete,
  openRename,
  openDirectory,
  openPreview,
  goUp,
  copySelection: () => clipboard.copy(selectedEntries.value),
  cutSelection: () => clipboard.cut(selectedEntries.value),
  paste: () => clipboard.pasteIntoCurrent(),
});

onMounted(() => {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousedown', onOutsideMouseDown, true);
  if (client.device) {
    load();
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  document.removeEventListener('mousedown', onOutsideMouseDown, true);
});
</script>

<template>
  <div
    ref="rootRef"
    class="file-manager"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="fm-toolbar">
      <div class="fm-crumbs">
        <v-btn
          icon
          variant="text"
          size="x-small"
          title="回到 /sdcard"
          :disabled="currentPath === '/sdcard'"
          @click="goHome"
        >
          <v-icon size="16" :icon="mdiHomeOutline" />
        </v-btn>
        <v-btn
          icon
          variant="text"
          size="x-small"
          title="后退"
          :disabled="!canGoBack"
          @click="goBack"
        >
          <v-icon size="16" :icon="mdiArrowLeft" />
        </v-btn>
        <v-btn
          icon
          variant="text"
          size="x-small"
          title="前进"
          :disabled="!canGoForward"
          @click="goForward"
        >
          <v-icon size="16" :icon="mdiArrowRight" />
        </v-btn>
        <v-btn
          icon
          variant="text"
          size="x-small"
          title="刷新"
          :loading="loading"
          @click="load()"
        >
          <v-icon size="16" :icon="mdiRefresh" />
        </v-btn>
        <PlacesMenu :current-path="currentPath" @navigate="navigate" />
        <span class="fm-nav-sep" />
        <div v-if="editingPath" class="fm-crumb-edit">
          <input
            ref="pathField"
            v-model="pathInput"
            class="fm-path-input"
            spellcheck="false"
            autocomplete="off"
            @keydown.enter="submitPath"
            @keydown.esc="editingPath = false"
            @blur="editingPath = false"
          />
        </div>
        <div v-else class="fm-crumb-list" @click="onCrumbAreaClick">
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
            <span v-if="index" class="fm-crumb-sep">/</span>
            <button
              type="button"
              class="fm-crumb"
              :class="{ active: crumb.path === currentPath }"
              @click="onCrumbClick(crumb, index)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </div>
      </div>

      <div class="fm-tools">
        <v-btn icon variant="text" size="x-small" title="新建目录" @click="openMkdirDialog">
          <v-icon size="16" :icon="mdiFolderPlusOutline" />
        </v-btn>
        <v-btn icon variant="text" size="x-small" title="上传文件" @click="pickUpload">
          <v-icon size="16" :icon="mdiUpload" />
        </v-btn>
        <v-btn icon variant="text" size="x-small" title="上传目录" @click="pickUploadFolder">
          <v-icon size="16" :icon="mdiFolderUploadOutline" />
        </v-btn>
        <v-btn
          icon
          variant="text"
          size="x-small"
          :title="viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'"
          @click="toggleView"
        >
          <v-icon size="16" :icon="viewMode === 'list' ? mdiViewGridOutline : mdiViewListOutline" />
        </v-btn>
        <FilterMenu v-model="fileFilter" />
        <v-btn
          icon
          variant="text"
          size="x-small"
          title="在设备上搜索"
          @click="searchDialog = true"
        >
          <v-icon size="16" :icon="mdiFolderSearchOutline" />
        </v-btn>
        <v-menu location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" size="x-small" title="排序">
              <v-icon size="16" :icon="mdiSort" />
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              title="按名称"
              :prepend-icon="mdiSortAlphabeticalAscending"
              :active="sortKey === 'name'"
              :append-icon="sortKey === 'name' ? (sortAsc ? mdiArrowUp : mdiArrowDown) : undefined"
              @click="setSort('name')"
            />
            <v-list-item
              title="按大小"
              :prepend-icon="mdiSortNumericAscending"
              :active="sortKey === 'size'"
              :append-icon="sortKey === 'size' ? (sortAsc ? mdiArrowUp : mdiArrowDown) : undefined"
              @click="setSort('size')"
            />
            <v-list-item
              title="按修改时间"
              :prepend-icon="mdiClockOutline"
              :active="sortKey === 'mtime'"
              :append-icon="sortKey === 'mtime' ? (sortAsc ? mdiArrowUp : mdiArrowDown) : undefined"
              @click="setSort('mtime')"
            />
          </v-list>
        </v-menu>
      </div>
    </div>

    <!-- 多选时工具条顶替搜索框的位置，两者高度一致，切换时不跳变 -->
    <div class="fm-search">
      <div v-if="multiSelectMode" class="fm-selection">
        <span class="fm-selection-count">
          {{ selectedPaths.length ? `已选 ${selectedPaths.length} 项` : '多选模式' }}
        </span>
        <div class="fm-tools">
          <v-btn
            icon
            variant="text"
            size="x-small"
            title="全选"
            :disabled="allVisibleSelected"
            @click="selectAll"
          >
            <v-icon size="16" :icon="mdiSelectAll" />
          </v-btn>
          <v-btn
            icon
            variant="text"
            size="x-small"
            title="反选"
            @click="invertSelection"
          >
            <v-icon size="16" :icon="mdiCheckboxMultipleOutline" />
          </v-btn>
          <v-btn
            icon
            variant="text"
            size="x-small"
            title="清空选择"
            :disabled="!selectedPaths.length"
            @click="clearSelected"
          >
            <v-icon size="16" :icon="mdiSelectionRemove" />
          </v-btn>
          <v-btn
            icon
            variant="text"
            size="x-small"
            title="下载所选"
            :disabled="!selectedFiles.length"
            @click="download(selectedFiles)"
          >
            <v-icon size="16" :icon="mdiDownload" />
          </v-btn>
          <v-btn
            icon
            variant="text"
            size="x-small"
            title="移动所选"
            :disabled="!selectedPaths.length"
            @click="openMove(selectedEntries)"
          >
            <v-icon size="16" :icon="mdiFileMoveOutline" />
          </v-btn>
          <v-btn
            icon
            variant="text"
            size="x-small"
            color="error"
            title="删除所选"
            :disabled="!selectedPaths.length"
            @click="askDelete(selectedEntries)"
          >
            <v-icon size="16" :icon="mdiDeleteOutline" />
          </v-btn>
          <v-btn icon variant="text" size="x-small" title="退出多选" @click="clearSelection">
            <v-icon size="16" :icon="mdiClose" />
          </v-btn>
        </div>
      </div>

      <v-text-field
        v-else
        :model-value="searchInput"
        placeholder="搜索当前目录"
        :prepend-inner-icon="mdiMagnify"
        clearable
        hide-details
        @update:model-value="searchInput = $event ?? ''"
      />
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      class="fm-file-input"
      @change="handleUploadSelect"
    />
    <input
      ref="folderInput"
      type="file"
      webkitdirectory
      multiple
      class="fm-file-input"
      @change="handleUploadSelect"
    />

    <FileBrowser
      ref="browser"
      v-model:selected="selectedPaths"
      v-model:multi-select="multiSelectMode"
      :path="currentPath"
      :entries="visibleEntries"
      :loading="loading"
      :keyword="search"
      :filtered="filtered"
      :view-mode="viewMode"
      @activate="openPreview"
      @navigate="openDirectory"
      @context="openContextMenu"
      @blank-context="openBlankMenu"
      @move="dropOnDirectory"
    />

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.show"
      class="fm-context-backdrop"
      @mousedown="closeContextMenu"
      @contextmenu.prevent="closeContextMenu"
    />
    <div
      v-if="contextMenu.show"
      class="fm-context"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @contextmenu.prevent
    >
      <v-list density="compact">
        <template v-for="(action, index) in contextMenu.actions" :key="action.title">
          <v-divider v-if="needsDivider(action, index)" />
          <v-list-item
            :title="action.title"
            :prepend-icon="action.icon"
            :class="{ 'fm-context-danger': action.color === 'error' }"
            @click="runContextAction(action)"
          />
        </template>
      </v-list>
    </div>

    <!-- 传输进度 -->
    <v-dialog :model-value="!!task" persistent max-width="400">
      <v-card>
        <v-card-title>{{ task?.title }}</v-card-title>
        <v-card-text>
          <div class="mb-2 fm-ellipsis">{{ task?.name }}</div>
          <v-progress-linear
            :model-value="(task?.value ?? 0) * 100"
            :indeterminate="task?.indeterminate"
            :style="{ '--progress': (task?.value ?? 0) * 100 + '%' }"
            height="18"
            color="primary"
          >
            <template #default="{ value }">
              <strong v-if="!task?.indeterminate">{{ Math.ceil(value) }}%</strong>
            </template>
          </v-progress-linear>
          <div v-if="task?.detail" class="dialog-note">{{ task?.detail }}</div>
          <div class="dialog-note">{{ task?.hint }}</div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- 新建目录 -->
    <v-dialog v-model="mkdirDialog" max-width="400">
      <v-card>
        <v-card-title>新建目录</v-card-title>
        <v-card-text>
          <v-text-field
            :model-value="mkdirName"
            label="名称"
            autofocus
            :error-messages="mkdirError"
            @update:model-value="setMkdirName"
            @blur="clearNameError"
            @change="clearNameError"
            @keyup.enter="confirmMkdir"
          />
          <div class="dialog-note fm-ellipsis" :title="currentPath">创建到 {{ currentPath }}</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" color="secondary" @click="mkdirDialog = false">取消</v-btn>
          <v-btn size="small" variant="flat" color="primary" @click="confirmMkdir">创建</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 重命名 -->
    <v-dialog v-model="renameDialog" max-width="400">
      <v-card>
        <v-card-title>重命名</v-card-title>
        <v-card-text>
          <div class="dialog-note fm-ellipsis" :title="renameTarget?.path">当前名称：{{ renameTarget?.name }}</div>
          <v-text-field
            :model-value="renameName"
            label="新名称"
            autofocus
            :error-messages="renameError"
            @update:model-value="setRenameName"
            @blur="clearNameError"
            @change="clearNameError"
            @keyup.enter="confirmRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" color="secondary" @click="renameDialog = false">取消</v-btn>
          <v-btn size="small" variant="flat" color="primary" @click="confirmRename">重命名</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 移动到 -->
    <MoveDialog
      v-model="moveDialog"
      :entries="moveEntries"
      :initial="currentPath"
      @confirm="confirmMove"
      @error="notify($event, 'error')"
    />

    <!-- 移动确认：拖拽放下时 -->
    <v-dialog v-model="dragMoveDialog" max-width="400">
      <v-card>
        <v-card-title>
          {{ dragMoveEntries.length > 1 ? `移动 ${dragMoveEntries.length} 项` : `移动「${dragMoveEntries[0]?.name}」` }}
        </v-card-title>
        <v-card-text>
          <div class="fm-ellipsis" :title="dragMoveTarget">将移动到 {{ dragMoveTarget }}</div>
          <div class="dialog-note">目标目录里已有同名文件时会被覆盖</div>
        </v-card-text>
        <v-card-actions>
          <v-checkbox
            v-model="noConfirmAgain"
            label="以后拖拽移动不再确认"
            density="compact"
            hide-details
            class="fm-option"
          />
          <v-spacer />
          <v-btn size="small" variant="text" color="secondary" @click="dragMoveDialog = false">取消</v-btn>
          <v-btn size="small" variant="flat" color="primary" @click="confirmDragMove">移动</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 删除确认 -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>
          删除 {{ deleteEntries.length }} 项
        </v-card-title>
        <v-card-text>
          确认要彻底删除这些内容吗？
          <div class="dialog-alert">
            <v-icon size="14" :icon="mdiAlertOutline" />
            删除后将无法恢复，请谨慎操作
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" color="secondary" @click="deleteDialog = false">取消</v-btn>
          <v-btn size="small" variant="flat" color="error" @click="confirmDelete">删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 解压确认 -->
    <ExtractDialog
      v-model="extractDialog"
      :entry="extractEntry"
      :target="currentPath"
      :busy="extractBusy"
      @confirm="confirmExtract"
    />

    <!-- 浏览器内解压二次确认 -->
    <v-dialog v-model="extractFallback" max-width="420">
      <v-card>
        <v-card-title>解压操作出现异常</v-card-title>
        <v-card-text>
          设备自带工具无法处理此压缩包，是否尝试高级解压操作？
          <div class="dialog-alert">
            <v-icon size="14" :icon="mdiAlertOutline" />
            文件需要往返进行处理，解压速度可能较慢
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" color="secondary" @click="resolveExtractFallback(false)">取消</v-btn>
          <v-btn size="small" variant="flat" color="primary" @click="resolveExtractFallback(true)">继续解压</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 预览 -->
    <PreviewDialog
      v-model="previewDialog"
      :entry="previewEntry"
      :entries="visibleEntries"
      @update:entry="previewEntry = $event"
      @download="downloadEntry"
      @extract="askExtract"
      @error="notify($event, 'error')"
      @closed="previewEntry = null"
    />

    <!-- 外观设置 -->
    <AppearanceDialog v-model="appearanceDialog" />

    <!-- 校验和 -->
    <ChecksumDialog v-model="checksumDialog" :entry="checksumEntry" @error="notify($event, 'error')" />

    <!-- 在设备上搜索 -->
    <SearchDialog
      v-model="searchDialog"
      :root="currentPath"
      @open="openFound"
      @enter="openDirectory"
      @preview="previewFound"
      @download="downloadFound"
    />

    <!-- 拖拽上传提示 -->
    <div v-if="dragging" class="fm-drop">
      <v-icon size="34" :icon="mdiUpload" />
      <div class="fm-drop-title">松开鼠标即可上传</div>
      <div class="fm-drop-path" :title="currentPath">{{ currentPath }}</div>
    </div>

    <v-snackbar v-model="showMessage" :color="messageType" timeout="2500" location="top">
      {{ message }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.file-manager {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.file-manager :deep(input),
.file-manager :deep(textarea),
.file-manager :deep([contenteditable='true']) {
  user-select: text;
  -webkit-user-select: text;
}

.fm-drop {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 2px dashed rgb(var(--v-theme-accent));
  background: rgba(99, 102, 241, 0.09);
  color: rgb(var(--v-theme-accent));
  pointer-events: none;
}

.fm-drop-title {
  font-size: 13px;
  font-weight: 600;
}

.fm-drop-path {
  max-width: 90%;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}

.fm-crumbs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.fm-crumb-list {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.fm-crumb-list::-webkit-scrollbar {
  display: none;
}

.fm-crumb {
  border: none;
  background: none;
  padding: 2px 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
}

.fm-crumb:hover {
  color: rgba(24, 24, 27, 0.85);
}

.fm-crumb.active {
  color: rgba(24, 24, 27, 0.9);
  font-weight: 600;
}

.fm-crumb-edit {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
}

.fm-path-input {
  width: 100%;
  min-width: 0;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  font-family: inherit;
  font-size: 12px;
  color: rgba(24, 24, 27, 0.9);
  outline: none;
}

.fm-path-input:focus {
  border-color: #6366f1;
}

.fm-crumb-sep {
  font-size: 12px;
  color: var(--muted);
  opacity: 0.6;
}

.fm-nav-sep {
  flex-shrink: 0;
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--border);
}

.fm-tools {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.fm-selection {
  flex: 1 1 auto;
  min-width: 0;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 4px 0 8px;
  border: 1px solid rgba(99, 102, 241, 0.28);
  background: rgba(99, 102, 241, 0.07);
}

.fm-selection-count {
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-accent));
  white-space: nowrap;
}

.fm-search {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px;
}

.fm-search :deep(.v-field) {
  min-height: 34px;
  height: 34px;
  font-size: 12px;
}

.fm-search :deep(.v-field__input) {
  height: 100%;
  min-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  font-size: 12px;
}

.fm-file-input {
  display: none;
}

.fm-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.fm-context {
  position: fixed;
  z-index: 21;
  min-width: 180px;
  transform-origin: top left;
  animation: fm-context-in 0.12s ease-out;
}

@keyframes fm-context-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fm-context {
    animation: none;
  }
}

.fm-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-option {
  margin-left: -8px;
}

.fm-option :deep(.v-label) {
  font-size: 12px;
  opacity: 1;
  color: rgba(24, 24, 27, 0.6);
}
</style>
