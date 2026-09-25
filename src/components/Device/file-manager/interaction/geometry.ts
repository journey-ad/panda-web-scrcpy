/**
 * 列表与网格的几何判定
 * 条目位置由行列推导，点击与框选共用同一套布局
 */

/** 网格里每一项的选择器 */
export const GRID_ITEM = '.fm-cell';

const CORE_PARTS = '.fm-cell-thumb, .fm-cell-icon, .fm-cell-name, .fm-cell-meta';

/** 超过这段位移即判定为非点击：拖拽与框选都以它为起点阈值 */
export const DRAG_THRESHOLD = 5;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 框选命中所需的布局：条目位置由行列推导，与当前渲染了哪些元素无关 */
export interface ItemLayout {
  /** 内容坐标系的原点，即滚动容器的内边距 */
  padTop: number;
  padLeft: number;
  /** 每行的纵向步进与每列的横向步进 */
  rowStep: number;
  colStep: number;
  /** 一行的列数，列表为 1 */
  cols: number;
  itemWidth: number;
  itemHeight: number;
}

/** 实测出的条目尺寸，拼装布局用 */
export interface LayoutMetrics {
  padTop: number;
  padLeft: number;
  isGrid: boolean;
  strideX: number;
  strideY: number;
  itemWidth: number;
  itemHeight: number;
  cols: number;
  /** 滚动容器的内容宽度，列表一行占满时用它 */
  bodyWidth: number;
}

/** 由实测尺寸拼出条目布局，尺寸未测出时返回 null */
export const buildItemLayout = (metrics: LayoutMetrics): ItemLayout | null => {
  if (!metrics.itemHeight) return null;
  if (metrics.isGrid) {
    if (!metrics.itemWidth) return null;
    return {
      padTop: metrics.padTop,
      padLeft: metrics.padLeft,
      rowStep: metrics.strideY,
      colStep: metrics.strideX,
      cols: metrics.cols,
      itemWidth: metrics.itemWidth,
      itemHeight: metrics.itemHeight,
    };
  }
  // 列表一行一项，横向占满，纵向按行等高排列
  return {
    padTop: metrics.padTop,
    padLeft: metrics.padLeft,
    rowStep: metrics.strideY,
    colStep: metrics.bodyWidth,
    cols: 1,
    itemWidth: metrics.bodyWidth,
    itemHeight: metrics.strideY,
  };
};

/** 框选矩形，四个边都在内容坐标系里 */
export interface MarqueeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 框选命中的条目下标，按行列几何推导，未渲染的条目同样能命中
 * 只走与选框纵向相交的行区间，横向再逐列判相交
 */
export const marqueeHits = (layout: ItemLayout, box: MarqueeBox, count: number): number[] => {
  const { padTop, padLeft, rowStep, colStep, cols, itemWidth, itemHeight } = layout;
  const hits: number[] = [];
  if (!rowStep || !colStep || count <= 0) return hits;

  const lastRow = Math.ceil(count / cols) - 1;
  const fromRow = Math.max(0, Math.floor((box.top - padTop) / rowStep) - 1);
  const toRow = Math.min(lastRow, Math.floor((box.bottom - padTop) / rowStep));

  for (let row = fromRow; row <= toRow; row += 1) {
    const itemTop = padTop + row * rowStep;
    if (itemTop >= box.bottom || itemTop + itemHeight <= box.top) continue;
    const start = row * cols;
    const end = Math.min(count, start + cols);
    for (let index = start; index < end; index += 1) {
      const itemLeft = padLeft + (index - start) * colStep;
      if (itemLeft < box.right && itemLeft + itemWidth > box.left) {
        hits.push(index);
      }
    }
  }
  return hits;
};

const boxOf = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
};

/**
 * 核心区域：图标与两行文字连成的一片
 * 上下两块之间的空隙归较窄的那块，由它延伸补上
 */
const corePartsOf = (cell: Element): Box[] => {
  const parts = Array.from(cell.querySelectorAll(CORE_PARTS), boxOf).sort((a, b) => a.top - b.top);
  const wide = (box: Box) => box.right - box.left;
  return parts.map((part, index) => {
    const above = parts[index - 1];
    const below = parts[index + 1];
    return {
      left: part.left,
      right: part.right,
      top: above && wide(part) <= wide(above) ? Math.min(part.top, above.bottom) : part.top,
      bottom: below && wide(part) <= wide(below) ? Math.max(part.bottom, below.top) : part.bottom,
    };
  });
};

const inBox = (box: Box, x: number, y: number): boolean =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

const inAny = (boxes: Box[], x: number, y: number) => boxes.some((box) => inBox(box, x, y));

/** 坐标是否落在核心区域内 */
export const inCore = (cell: Element, x: number, y: number) => inAny(corePartsOf(cell), x, y);

export interface GridClickQuery {
  /** 网格里的那一项 */
  cell: Element;
  /** 按下点 */
  startX: number;
  startY: number;
  /** 抬起点 */
  x: number;
  y: number;
  /** 多选模式下整格都用于勾选 */
  multiSelect: boolean;
}

/** 按下与抬起都要落在核心区域内才算点击；多选模式下整格都能勾选 */
export const isGridClick = (query: GridClickQuery): boolean => {
  const { cell, startX, startY, x, y, multiSelect } = query;
  if (Math.abs(x - startX) > DRAG_THRESHOLD || Math.abs(y - startY) > DRAG_THRESHOLD) return false;
  if (multiSelect) return inBox(boxOf(cell), x, y);
  const parts = corePartsOf(cell);
  return inAny(parts, startX, startY) && inAny(parts, x, y);
};
