import { computed, nextTick, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue';

import type { FileEntry } from '../model/types';

/** 条目数少于此值时全部渲染 */
const VIRTUAL_MIN_ROWS = 60;
/** 网格视图启用虚拟滚动的行数下限 */
const VIRTUAL_MIN_GRID_ROWS = 20;
/** 视口外上下各多渲染的行数 */
const VIRTUAL_OVERSCAN = 6;

export interface VirtualRowsOptions {
  /** 滚动容器，滚动窗口与视口尺寸都以它为准 */
  body: Ref<HTMLElement | null>;
  /** 列表容器，行高按其中的行测量 */
  list: Ref<HTMLElement | null>;
  /** 网格容器，格子大小按其中的格子测量 */
  grid: Ref<HTMLElement | null>;
  entries: Ref<FileEntry[]>;
  viewMode: Ref<'list' | 'grid'>;
  /** 网格一行的列数 */
  cols: Ref<number>;
  /** 列表副标题会改变行高，切换后重新测量 */
  listShowMeta: Ref<boolean>;
}

/**
 * 列表与网格共用的虚拟滚动：条目尺寸由渲染结果测量，未渲染的行用留白占位
 * 步进未测出时全部渲染，切换视图前先作废步进
 */
export const useVirtualRows = (options: VirtualRowsOptions) => {
  const { body, list, grid, entries, viewMode, cols, listShowMeta } = options;

  /** 条目尺寸由渲染结果测量：列表为行高，网格为格子边长 */
  const itemHeight = ref(0);
  const itemWidth = ref(0);
  /** 相邻条目的位置差，即行距与列距 */
  const strideY = ref(0);
  const strideX = ref(0);
  /** 网格的行列间距 */
  const gridGap = ref(0);
  /** 格子内容宽，网格按它缩放图标与标题 */
  const cellInnerWidth = ref(0);
  /** 滚动容器内边距，框选命中时换算内容坐标原点 */
  const bodyPadding = ref({ top: 0, left: 0 });
  const viewportHeight = ref(0);
  /** 滚动位置，缩略图按它判断可见条目 */
  const scrollTop = ref(0);
  /** 渲染窗口的起始行 */
  const windowStart = ref(0);

  const isGrid = computed(() => viewMode.value === 'grid');
  /** 网格一行多列、列表一行一列，均按行虚拟化 */
  const rowCols = computed(() => (isGrid.value ? cols.value : 1));
  /** 行的纵向步进，即相邻两行的位置差 */
  const rowStep = computed(() => strideY.value);
  const rowCount = computed(() => Math.ceil(entries.value.length / rowCols.value));

  const virtual = computed(() =>
    isGrid.value ? rowCount.value > VIRTUAL_MIN_GRID_ROWS : rowCount.value > VIRTUAL_MIN_ROWS
  );

  /** 实际渲染的条目，未启用虚拟滚动时为全部条目 */
  const rendered = computed(() => {
    if (!virtual.value || !rowStep.value) return entries.value;
    const count = Math.ceil(viewportHeight.value / rowStep.value) + VIRTUAL_OVERSCAN * 2;
    const start = windowStart.value * rowCols.value;
    return entries.value.slice(start, start + count * rowCols.value);
  });

  /** 未渲染的行用上下留白占位，滚动条长度与全部渲染时一致 */
  const padTop = computed(() => (virtual.value ? windowStart.value * rowStep.value : 0));
  const padBottom = computed(() => {
    if (!virtual.value) return 0;
    const endRow = windowStart.value + rendered.value.length / rowCols.value;
    return Math.max(0, (rowCount.value - endRow) * rowStep.value);
  });

  /** 网格的列模板与上下留白 */
  const gridStyle = computed(() => {
    const style: Record<string, string | number> = {
      gridTemplateColumns: `repeat(${cols.value}, minmax(0, 1fr))`,
      '--cols': cols.value,
      paddingTop: `${padTop.value}px`,
      paddingBottom: `${padBottom.value}px`,
    };
    // 优先使用实测的格子内容宽，未测出时回退到样式中的计算值
    if (cellInnerWidth.value) style['--cell-w'] = `${cellInnerWidth.value}px`;
    return style;
  });

  /** 视口首行，缩略图队列按行号排序 */
  const topRow = computed(() => (rowStep.value ? Math.floor(scrollTop.value / rowStep.value) : 0));

  /** 按滚动位置与行步进重算渲染窗口 */
  const syncWindow = () => {
    const element = body.value;
    if (!element) return;
    const top = element.scrollTop;
    scrollTop.value = top;
    windowStart.value = rowStep.value
      ? Math.min(rowCount.value, Math.max(0, Math.floor(top / rowStep.value) - VIRTUAL_OVERSCAN))
      : 0;
  };

  /** 视口尺寸由 ResizeObserver 同步 */
  const syncViewport = () => {
    const element = body.value;
    if (!element) return;
    viewportHeight.value = element.clientHeight;
    syncWindow();
  };

  /** 滚动事件按帧合并，一帧最多重算一次渲染窗口 */
  let scrollFrame = 0;
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      syncWindow();
    });
  };

  /** 当前视口内可见的条目，不含渲染窗口上下预留的行 */
  const inViewport = computed(() => {
    const step = rowStep.value;
    // 未启用虚拟滚动时为全部条目；步进未测出时返回空
    if (!virtual.value) return entries.value;
    if (!step) return [];
    const start = topRow.value * rowCols.value;
    const rows = Math.ceil(viewportHeight.value / step) + 1;
    return entries.value.slice(start, start + rows * rowCols.value);
  });

  /** 面板与格子的尺寸观察器 */
  let resizeObserver: ResizeObserver | null = null;
  let cellObserver: ResizeObserver | null = null;
  let observedCell: HTMLElement | null = null;

  /** 重新绑定观察目标：虚拟滚动会替换格子元素，列表视图不观察 */
  const observeCell = () => {
    if (!cellObserver) return;
    const cell = isGrid.value ? (grid.value?.querySelector<HTMLElement>('.fm-cell') ?? null) : null;
    if (cell === observedCell) return;
    if (observedCell) cellObserver.unobserve(observedCell);
    observedCell = cell;
    if (cell) cellObserver.observe(cell);
  };

  /** 由渲染结果测量格子大小与行列步进 */
  const measureGrid = () => {
    const element = grid.value;
    const cells = element ? Array.from(element.querySelectorAll<HTMLElement>('.fm-cell')) : [];
    if (!element || !cells.length) return;
    const first = cells[0];
    const rect = first.getBoundingClientRect();
    itemHeight.value = rect.height;
    itemWidth.value = rect.width;

    // 格子内容宽直接取预览框的宽度
    const preview = first.querySelector<HTMLElement>('.fm-cell-preview');
    const style = getComputedStyle(first);
    cellInnerWidth.value = preview
      ? preview.getBoundingClientRect().width
      : Math.max(0, rect.width - (Number.parseFloat(style.paddingLeft) || 0) * 2);

    const gap = Number.parseFloat(getComputedStyle(element).rowGap);
    gridGap.value = Number.isFinite(gap) ? gap : 0;

    const nextRow = cells.find((cell) => cell.offsetTop > first.offsetTop);
    const nextCol = cells.find(
      (cell) => cell.offsetTop === first.offsetTop && cell.offsetLeft > first.offsetLeft
    );
    strideY.value = nextRow ? nextRow.getBoundingClientRect().top - rect.top : rect.height + gridGap.value;
    strideX.value = nextCol ? nextCol.getBoundingClientRect().left - rect.left : rect.width + gridGap.value;
  };

  /** 行高与格子大小都由渲染结果测量 */
  const measure = () => {
    const element = body.value;
    if (element) {
      const style = getComputedStyle(element);
      bodyPadding.value = {
        top: Number.parseFloat(style.paddingTop) || 0,
        left: Number.parseFloat(style.paddingLeft) || 0,
      };
    }
    if (isGrid.value) {
      measureGrid();
      return;
    }
    const rows = list.value?.querySelectorAll<HTMLElement>('.fm-row');
    if (!rows?.length) return;
    const rect = rows[0].getBoundingClientRect();
    itemHeight.value = rect.height;
    itemWidth.value = element?.clientWidth ?? rect.width;
    // 相邻两行的位置差即行步进
    strideY.value = rows.length > 1 ? rows[1].getBoundingClientRect().top - rect.top : rect.height;
  };

  /**
   * 重新测量条目尺寸，并等待占位高度按新步进更新
   */
  const remeasure = async () => {
    await nextTick();
    measure();
    observeCell();
    await nextTick();
  };

  /** 行步进变化后按新步进重算窗口与留白 */
  watch(rowStep, syncWindow);

  watch([entries, listShowMeta, cols], async () => {
    await remeasure();
    syncWindow();
  });

  /** 渲染完成后重新绑定格子观察 */
  watch(rendered, observeCell, { flush: 'post' });

  onMounted(() => {
    const element = body.value;
    if (!element) return;
    resizeObserver = new ResizeObserver(syncViewport);
    resizeObserver.observe(element);
    cellObserver = new ResizeObserver(() => {
      // 格子尺寸变化后重新测量并同步窗口
      measureGrid();
      syncWindow();
    });
    measure();
    syncViewport();
    observeCell();
  });

  onScopeDispose(() => {
    resizeObserver?.disconnect();
    cellObserver?.disconnect();
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
  });

  /** 两个视图的步进差异很大，切换前先作废步进 */
  const resetStride = () => {
    strideY.value = 0;
    strideX.value = 0;
  };

  return {
    onScroll,
    resetStride,
    rendered,
    padTop,
    padBottom,
    gridStyle,
    inViewport,
    remeasure,
    syncWindow,
    /** 框选命中按它推算条目位置 */
    metrics: {
      isGrid,
      cols: rowCols,
      rowStep,
      virtual,
      itemHeight,
      itemWidth,
      strideX,
      strideY,
      cellInnerWidth,
      bodyPadding,
    },
  };
};
