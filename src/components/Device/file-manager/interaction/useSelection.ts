import { computed, onScopeDispose, ref, type Ref } from 'vue';

import { DRAG_THRESHOLD, GRID_ITEM, inCore, isGridClick, marqueeHits, type ItemLayout } from './geometry';
import type { FileEntry } from '../model/types';

/** 打开目录后短暂忽略点击，双击的第二下不作用在新列表上 */
const CLICK_SUPPRESS_MS = 300;
/** 边界自动滚动的边带宽度：指针进入容器边缘该距离内触发 */
const EDGE = 24;
/** 每帧最大滚动像素，贴近边缘时达到 */
const MAX_SCROLL = 28;

interface DragState {
  /** 光标最新的视口坐标，判定拖拽与绘制选框都用它 */
  clientX: number;
  clientY: number;
  active: boolean;
  base: string[];
  path: string | null;
  /** 按下点是否落在可拖拽元素上 */
  handle: boolean;
  /** 按下点是否算在网格的某一项上，抬起时据此判定点击 */
  grid: boolean;
  /** 起点锚定在内容坐标系里，滚动时与列表一起移动 */
  anchorX: number;
  anchorY: number;
  /** 起点在视口里的位置，滚动后重算，仅供绘制 */
  anchorClientX: number;
  anchorClientY: number;
}

interface SelectionOptions {
  /** 当前展示的条目，决定 shift 连选的顺序与框选命中的范围 */
  visible: Ref<FileEntry[]>;
  /** 列表滚动容器，框选以它为参照 */
  body: Ref<HTMLElement | null>;
  /** 条目布局，未测量出来时返回 null */
  layout: () => ItemLayout | null;
  /** 选区由调用方持有，工具栏与列表共用同一份 */
  selected: Ref<string[]>;
  multiSelect: Ref<boolean>;
  /** 单击目录时完成导航 */
  onNavigate: (entry: FileEntry) => void;
  /** 单击文件时打开预览 */
  onActivate: (entry: FileEntry) => void;
}

/**
 * 列表的选择交互：单击、Ctrl/Shift 连选、空白处框选
 */
export const useSelection = (options: SelectionOptions) => {
  const { visible, body, layout, selected, multiSelect, onNavigate, onActivate } = options;

  const anchorPath = ref<string | null>(null);
  /** shift 连选开始前的选区，连选在它基础上取并集 */
  const rangeBase = ref<string[]>([]);
  const dragState = ref<DragState | null>(null);
  const entryByPath = computed(() => new Map(visible.value.map((entry) => [entry.path, entry])));
  /** 选区集合，条目判定按路径查表 */
  const selectedSet = computed(() => new Set(selected.value));

  let suppressUntil = 0;
  const isSuppressed = () => Date.now() < suppressUntil;

  /** 自动滚动的 rAF 句柄，0 表示未在滚动 */
  let scrollRAF = 0;

  const isSelected = (path: string) => selectedSet.value.has(path);

  /**
   * 选区、锚点与连选基准总是一起更新
   * 刚写入的选区在父组件更新前读到仍是旧值，锚点与基准只用本次计算得到的数组推导
   */
  const commit = (paths: string[], anchor: string | null = null) => {
    selected.value = paths;
    anchorPath.value = anchor;
    rangeBase.value = paths;
  };

  /** 直接替换选区，锚点落在最后一项 */
  const setSelection = (paths: string[]) => {
    commit(paths, paths.length ? paths[paths.length - 1] : null);
  };

  const clearSelection = () => {
    commit([]);
    multiSelect.value = false;
  };

  /** 只清空选区，不退出多选 */
  const clearSelected = () => {
    commit([]);
  };

  const togglePath = (path: string) => {
    const next = isSelected(path)
      ? selected.value.filter((item) => item !== path)
      : [...selected.value, path];
    commit(next, next.length ? path : null);
  };

  const selectAll = () => {
    const paths = visible.value.map((entry) => entry.path);
    // 全选后按 shift 应从第一项开始取区间
    commit(paths, paths[0] ?? null);
    multiSelect.value = true;
  };

  /** 在当前可见项里取反 */
  const invertSelection = () => {
    const current = new Set(selected.value);
    const next = visible.value.filter((entry) => !current.has(entry.path)).map((entry) => entry.path);
    commit(next);
    multiSelect.value = true;
  };

  const handleClick = (entry: FileEntry, modifiers: { ctrl: boolean; shift: boolean }) => {
    if (isSuppressed()) return;

    /** 一轮新的连选：锚点与基准都落在当前项上 */
    const restartRange = () => {
      commit([entry.path], entry.path);
      multiSelect.value = true;
    };

    if (modifiers.shift) {
      const paths = visible.value.map((item) => item.path);
      const from = anchorPath.value ? paths.indexOf(anchorPath.value) : -1;
      const to = paths.indexOf(entry.path);
      // 锚点已不在当前列表里时按新的一轮处理
      if (from === -1 || to === -1) {
        restartRange();
        return;
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      multiSelect.value = true;
      selected.value = [...new Set([...rangeBase.value, ...paths.slice(start, end + 1)])];
      return;
    }

    if (modifiers.ctrl) {
      multiSelect.value = true;
      togglePath(entry.path);
      return;
    }

    if (multiSelect.value) {
      togglePath(entry.path);
      return;
    }

    if (entry.isDirectory) {
      suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
      onNavigate(entry);
      return;
    }

    commit([entry.path], entry.path);
    onActivate(entry);
  };

  const marqueeRect = computed(() => {
    const drag = dragState.value;
    if (!drag?.active) return null;
    const left = Math.min(drag.anchorClientX, drag.clientX);
    const top = Math.min(drag.anchorClientY, drag.clientY);
    const right = Math.max(drag.anchorClientX, drag.clientX);
    const bottom = Math.max(drag.anchorClientY, drag.clientY);
    const element = body.value;
    if (!element) return { left, top, right, bottom };
    // 起点随滚动移出可视区，选框只画在滚动容器内
    const box = element.getBoundingClientRect();
    const clipped = {
      left: Math.max(left, box.left),
      top: Math.max(top, box.top),
      right: Math.min(right, box.left + element.clientWidth),
      bottom: Math.min(bottom, box.top + element.clientHeight),
    };
    return clipped.right <= clipped.left || clipped.bottom <= clipped.top ? null : clipped;
  });

  /** 视口坐标换算到滚动内容坐标，与条目位置同处一个坐标系 */
  const toContent = (clientX: number, clientY: number, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return {
      x: clientX - box.left + element.scrollLeft,
      y: clientY - box.top + element.scrollTop,
    };
  };

  /** 上一次框选的命中下标，命中集未变时跳过重写选区 */
  let lastHits: number[] = [];

  const sameHits = (a: number[], b: number[]) =>
    a.length === b.length && a.every((index, position) => index === b[position]);

/** 命中按数据推导：条目位置由行列计算得到，未渲染的条目同样能命中 */
  const applyMarquee = () => {
    const drag = dragState.value;
    const element = body.value;
    const metrics = layout();
    if (!drag?.active || !element || !metrics) return;
    const box = element.getBoundingClientRect();
    // 起点固定不动，只重算它在视口里的位置
    drag.anchorClientX = drag.anchorX - element.scrollLeft + box.left;
    drag.anchorClientY = drag.anchorY - element.scrollTop + box.top;
    // 光标端换算到内容坐标，两端同处一个坐标系
    const cursorX = drag.clientX - box.left + element.scrollLeft;
    const cursorY = drag.clientY - box.top + element.scrollTop;
    const hits = marqueeHits(
      metrics,
      {
        left: Math.min(drag.anchorX, cursorX),
        top: Math.min(drag.anchorY, cursorY),
        right: Math.max(drag.anchorX, cursorX),
        bottom: Math.max(drag.anchorY, cursorY),
      },
      visible.value.length
    );
    if (sameHits(hits, lastHits)) return;
    lastHits = hits;
    const paths = hits.map((index) => visible.value[index].path);
    selected.value = [...new Set([...drag.base, ...paths])];
  };

  /** 自动滚动循环：指针贴边时按渗透深度滚动，使选区延伸到边界外 */
  function tickAutoScroll() {
    const drag = dragState.value;
    const element = body.value;
    if (!drag?.active || !element) {
      scrollRAF = 0;
      return;
    }
    const box = element.getBoundingClientRect();
    const canScroll = {
      left: element.scrollLeft > 0,
      right: element.scrollLeft < element.scrollWidth - element.clientWidth - 0.5,
      top: element.scrollTop > 0,
      bottom: element.scrollTop < element.scrollHeight - element.clientHeight - 0.5,
    };
    let vx = 0;
    let vy = 0;
    const fromRight = box.right - drag.clientX;
    const fromLeft = drag.clientX - box.left;
    const fromBottom = box.bottom - drag.clientY;
    const fromTop = drag.clientY - box.top;
    if (fromRight < EDGE && canScroll.right) vx = MAX_SCROLL * (1 - fromRight / EDGE);
    else if (fromLeft < EDGE && canScroll.left) vx = -MAX_SCROLL * (1 - fromLeft / EDGE);
    if (fromBottom < EDGE && canScroll.bottom) vy = MAX_SCROLL * (1 - fromBottom / EDGE);
    else if (fromTop < EDGE && canScroll.top) vy = -MAX_SCROLL * (1 - fromTop / EDGE);
    if (vx !== 0 || vy !== 0) {
      element.scrollLeft += vx;
      element.scrollTop += vy;
      applyMarquee();
    }
    scrollRAF = requestAnimationFrame(tickAutoScroll);
  }

  const onDocMouseMove = (event: MouseEvent) => {
    const drag = dragState.value;
    // 按下点落在可拖拽元素上时由浏览器接管为拖拽移动，其余位置拖过阈值都起框选
    if (!drag || drag.handle) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (!drag.active) {
      const moved =
        Math.abs(event.clientX - drag.anchorClientX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - drag.anchorClientY) > DRAG_THRESHOLD;
      if (!moved) return;
      drag.active = true;
      multiSelect.value = true;
      if (!scrollRAF) scrollRAF = requestAnimationFrame(tickAutoScroll);
    }
    applyMarquee();
  };

  /** 拖拽途中滚动后按新的滚动位置重算选框与命中 */
  const onBodyScroll = () => {
    if (dragState.value?.active) applyMarquee();
  };

  const stopDragListeners = () => {
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
    body.value?.removeEventListener('scroll', onBodyScroll);
    if (scrollRAF) {
      cancelAnimationFrame(scrollRAF);
      scrollRAF = 0;
    }
  };

  /** 由路径取回当前渲染的网格单元，虚拟滚动可能已经换过节点 */
  const gridCellOf = (path: string | null) =>
    path ? body.value?.querySelector<HTMLElement>(`${GRID_ITEM}[data-path="${CSS.escape(path)}"]`) ?? null : null;

  /** 网格项按核心区域判定，列表按下即命中整行 */
  const isClick = (drag: DragState, x: number, y: number): boolean => {
    if (!drag.grid) return true;
    const cell = gridCellOf(drag.path);
    if (!cell) return false;
    return isGridClick({
      cell,
      startX: drag.anchorClientX,
      startY: drag.anchorClientY,
      x,
      y,
      multiSelect: multiSelect.value,
    });
  };

  const onDocMouseUp = (event: MouseEvent) => {
    const drag = dragState.value;
    stopDragListeners();
    dragState.value = null;
    if (!drag) return;

    if (drag.active) {
      // 框选本身就进入多选，即使没有命中任何条目也保持多选状态
      multiSelect.value = true;
      // 框选结果成为新的连选基准，锚点落在最后一项上
      rangeBase.value = selected.value;
      anchorPath.value = selected.value[selected.value.length - 1] ?? null;
      return;
    }

    if (!drag.path) {
      clearSelection();
      return;
    }

    const entry = entryByPath.value.get(drag.path);
    if (entry && isClick(drag, event.clientX, event.clientY)) {
      handleClick(entry, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
    }
  };

  const onBodyMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, label, a, .v-btn, .v-selection-control, .v-input')) return;

    // 位于滚动条上的按下不参与框选，不打断原生滚动条的拖动
    const element = body.value;
    if (element) {
      const rect = element.getBoundingClientRect();
      if (event.clientX - rect.left > element.clientWidth || event.clientY - rect.top > element.clientHeight) {
        return;
      }
    }

    // 多选态整格都算这一项；单选态只有按在核心区域内才算
    const cell = target.closest<HTMLElement>(GRID_ITEM);
    const handle = target.closest('[draggable="true"]');
    const inCoreArea = Boolean(handle) || (cell !== null && inCore(cell, event.clientX, event.clientY));
    const grid = cell !== null && (multiSelect.value || inCoreArea);
    const holder = cell ? (grid ? cell : null) : target.closest<HTMLElement>('[data-path]');
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    // 起点在此刻换算到内容坐标系，之后滚动仍锚在同一处内容上
    const anchor = element ? toContent(event.clientX, event.clientY, element) : { x: 0, y: 0 };
    lastHits = [];
    dragState.value = {
      clientX: event.clientX,
      clientY: event.clientY,
      active: false,
      base: additive ? [...selected.value] : [],
      path: holder?.dataset.path ?? null,
      handle: Boolean(handle),
      grid,
      anchorX: anchor.x,
      anchorY: anchor.y,
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
    };
    // 按下点不在可拖拽元素上时才阻止默认行为，不阻断原生拖拽
    if (!handle) event.preventDefault();
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);
    element?.addEventListener('scroll', onBodyScroll, { passive: true });
  };

  onScopeDispose(stopDragListeners);

  return {
    marqueeRect,
    isSelected,
    setSelection,
    togglePath,
    selectAll,
    invertSelection,
    clearSelected,
    clearSelection,
    onBodyMouseDown,
  };
};
