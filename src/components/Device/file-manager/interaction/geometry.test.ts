import { describe, expect, it } from 'vitest';

import { buildItemLayout, marqueeHits, type ItemLayout } from './geometry';

/** 列表：一行一项，横向占满 */
const listLayout: ItemLayout = {
  padTop: 4,
  padLeft: 6,
  rowStep: 30,
  colStep: 600,
  cols: 1,
  itemWidth: 600,
  itemHeight: 30,
};

/** 网格：一行四项，格子比步进略小 */
const gridLayout: ItemLayout = {
  padTop: 0,
  padLeft: 0,
  rowStep: 100,
  colStep: 100,
  cols: 4,
  itemWidth: 90,
  itemHeight: 90,
};

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('marqueeHits', () => {
  it('列表按行命中，跨过行边界的半行同样算中', () => {
    // 行区间 4-34、34-64、64-94、94-124，选框 10-100 压住前四行
    expect(marqueeHits(listLayout, box(0, 10, 600, 100), 8)).toEqual([0, 1, 2, 3]);
  });

  it('列表只圈住中间一行时只中该行', () => {
    expect(marqueeHits(listLayout, box(0, 35, 600, 63), 8)).toEqual([1]);
  });

  it('网格按行列命中，只圈住首行左侧两列', () => {
    expect(marqueeHits(gridLayout, box(0, 0, 150, 100), 12)).toEqual([0, 1]);
  });

  it('网格跨行时按整行取，末行不满也按实际条目数截断', () => {
    // 三行共 10 项，末行只有 2 项
    expect(marqueeHits(gridLayout, box(0, 0, 400, 300), 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('竖着只圈一列时其余列不中', () => {
    expect(marqueeHits(gridLayout, box(0, 0, 95, 300), 12)).toEqual([0, 4, 8]);
  });

  it('命中不受渲染窗口限制，未渲染的条目同样能中', () => {
    // 第 500 行起，远超任何渲染窗口
    const hits = marqueeHits(gridLayout, box(0, 50_000, 400, 50_100), 4000);
    expect(hits).toEqual([2000, 2001, 2002, 2003]);
  });

  it('步进未测出时不给命中', () => {
    expect(marqueeHits({ ...gridLayout, rowStep: 0 }, box(0, 0, 400, 300), 12)).toEqual([]);
  });

  it('退化成零宽或零高时按覆盖住的那条线命中', () => {
    // 竖线 x=50 落在首列格子的横向区间里，纵向压住前两行
    expect(marqueeHits(gridLayout, box(50, 50, 50, 200), 12)).toEqual([0, 4]);
    // 横线 y=50 落在首行格子的纵向区间里，横向压住整行
    expect(marqueeHits(gridLayout, box(0, 50, 400, 50), 12)).toEqual([0, 1, 2, 3]);
  });

  it('内容坐标带内边距时按内边距推算', () => {
    const padded = { ...listLayout, padTop: 20 };
    // 行区间 20-50、50-80、80-110，选框 55-105 压住后两行
    expect(marqueeHits(padded, box(0, 55, 600, 105), 4)).toEqual([1, 2]);
  });
});

describe('buildItemLayout', () => {
  const metrics = {
    padTop: 4,
    padLeft: 6,
    isGrid: true,
    strideX: 100,
    strideY: 110,
    itemWidth: 90,
    itemHeight: 90,
    cols: 4,
    bodyWidth: 600,
  };

  it('网格按实测的步进与列数拼出布局', () => {
    expect(buildItemLayout(metrics)).toEqual({
      padTop: 4,
      padLeft: 6,
      rowStep: 110,
      colStep: 100,
      cols: 4,
      itemWidth: 90,
      itemHeight: 90,
    });
  });

  it('列表一行占满容器宽度', () => {
    const list = buildItemLayout({
      padTop: 4,
      padLeft: 6,
      isGrid: false,
      strideX: 0,
      strideY: 30,
      itemWidth: 600,
      itemHeight: 30,
      cols: 1,
      bodyWidth: 600,
    });
    expect(list).toEqual(listLayout);
  });

  it('条目尺寸未测出时不给布局', () => {
    expect(buildItemLayout({ ...metrics, itemHeight: 0 })).toBeNull();
    expect(buildItemLayout({ ...metrics, itemWidth: 0 })).toBeNull();
  });
});
