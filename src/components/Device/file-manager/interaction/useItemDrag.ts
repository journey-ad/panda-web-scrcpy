import { ref, type Ref } from 'vue';

import { entryIcon } from '../ui/icons';
import type { FileEntry } from '../model/types';

/** 多选拖拽时最多渲染三层预览图层 */
const MAX_GHOST_LAYERS = 3;

interface DragOptions {
  /** 当前展示的条目，拖的是已选中项时整批一起走 */
  visible: Ref<FileEntry[]>;
  /** 当前选区，与列表共用同一份 */
  selected: Ref<string[]>;
  /** 网格缩略图，预览优先用图 */
  thumbOf: (entry: FileEntry) => string;
  /** 拖到目录上松开 */
  onMove: (entries: FileEntry[], target: string) => void;
}

/**
 * 条目的拖拽移动：拖到目录上松开即整批移过去
 * 只维护拖动中的条目与当前落点，是否真的移动由调用方决定
 */
export const useItemDrag = (options: DragOptions) => {
  const { visible, selected, thumbOf, onMove } = options;

  /** 正在拖的条目，dragover 阶段 dataTransfer 的内容不可读 */
  let dragging: FileEntry[] = [];
  /** 当前悬停的落点目录 */
  const dropDir = ref('');

  /** 已选中的项整批移动，未选中的项只移动自身 */
  const dragPayload = (entry: FileEntry) => {
    if (selected.value.length < 2 || !selected.value.includes(entry.path)) return [entry];
    return visible.value.filter((item) => selected.value.includes(item.path));
  };

  /** 缩略图尚未生成时用列表里那一项的类型图标，颜色与列表一致 */
  const ghostGlyph = (entry: FileEntry) => {
    const thumb = thumbOf(entry);
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'contain' });
      return img;
    }
    const source = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(entry.path)}"] .v-icon`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '26');
    svg.setAttribute('height', '26');
    svg.style.color = source ? getComputedStyle(source).color : 'rgba(24, 24, 27, 0.4)';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', entryIcon(entry));
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  };

  /** 多选拖拽的预览：卡片最多三层，左上角标出总数 */
  const buildDragGhost = (entries: FileEntry[], source: FileEntry) => {
    const ghost = document.createElement('div');
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '-240px',
      left: '0',
      width: '132px',
      height: '78px',
      pointerEvents: 'none',
    });

    // 第一张在最底层、往左上错开，最后一张在最前面
    const layers = entries.slice(0, MAX_GHOST_LAYERS);
    layers.forEach((_, index) => {
      const offset = (layers.length - 1 - index) * 6;
      const node = document.createElement('div');
      Object.assign(node.style, {
        position: 'absolute',
        inset: '0',
        transform: `translate(${-offset}px, ${-offset}px)`,
        border: '1px solid rgba(24, 24, 27, 0.16)',
        background: '#fff',
        boxShadow: index === layers.length - 1 ? '0 2px 10px rgba(24, 24, 27, 0.2)' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      });
      // 图形只取发起拖拽的那一项
      if (index === layers.length - 1) node.append(ghostGlyph(source));
      ghost.append(node);
    });

    const badge = document.createElement('span');
    badge.textContent = `${entries.length} 项`;
    Object.assign(badge.style, {
      position: 'absolute',
      top: '-9px',
      left: '-9px',
      padding: '1px 6px',
      background: '#6366f1',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '500',
      whiteSpace: 'nowrap',
    });
    ghost.append(badge);

    document.body.append(ghost);
    return ghost;
  };

  const onDragStart = (entry: FileEntry, event: DragEvent) => {
    dragging = dragPayload(entry);
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = 'move';
    transfer.setData('text/plain', dragging.map((item) => item.name).join('\n'));

    // 单条指定整个条目为拖拽预览，预览显示完整条目
    if (dragging.length < 2) {
      const item = event.currentTarget as HTMLElement;
      const rect = item.getBoundingClientRect();
      transfer.setDragImage(item, event.clientX - rect.left, event.clientY - rect.top);
      return;
    }
    // 多项时改用多层卡片预览
    const ghost = buildDragGhost(dragging, entry);
    transfer.setDragImage(ghost, 26, 26);
    // 快照在本轮事件处理之后才生成，等下一帧再移除
    requestAnimationFrame(() => ghost.remove());
  };

  const onDragEnd = () => {
    dragging = [];
    dropDir.value = '';
  };

  /** 只有目录能接，且落点本身不在这次拖动的条目中 */
  const canDropTo = (entry: FileEntry) =>
    entry.isDirectory && !dragging.some((item) => item.path === entry.path);

  const onDragOver = (entry: FileEntry, event: DragEvent) => {
    if (!canDropTo(entry)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dropDir.value = entry.path;
  };

  /** 指针在条目内部的子元素之间移动也会触发 leave，relatedTarget 还在里面就不算离开 */
  const onDragLeave = (entry: FileEntry, event: DragEvent) => {
    if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return;
    if (dropDir.value === entry.path) {
      dropDir.value = '';
    }
  };

  const onDrop = (entry: FileEntry, event: DragEvent) => {
    if (!dragging.length) return;
    event.preventDefault();
    const payload = dragging;
    // 落点在拖动的条目之中时忽略本次拖放
    const inside = payload.some((item) => item.path === entry.path);
    onDragEnd();
    if (entry.isDirectory && !inside) {
      onMove(payload, entry.path);
    }
  };

  return { dropDir, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop };
};
