import type { Ref } from 'vue';

import type { FileEntry } from '../model/types';

interface ShortcutOptions {
  /** 面板根元素，切换到其它标签后停止接管按键 */
  root: Ref<HTMLElement | null>;
  /** 弹窗或任务进行中时不接管按键 */
  blocked: () => boolean;
  /** 菜单打开时先关掉菜单；返回原本是否打开 */
  closeMenu: () => boolean;
  multiSelectMode: Ref<boolean>;
  clearSelection: () => void;
  selectedEntries: Ref<FileEntry[]>;
  selectAll: () => void;
  askDelete: (list: FileEntry[]) => void;
  openRename: (entry: FileEntry) => void;
  openDirectory: (entry: FileEntry) => void;
  openPreview: (entry: FileEntry) => void;
  goUp: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
}

/** 焦点在输入框里时不接管按键，打字与文本全选由输入框处理 */
const isTyping = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]');

/** 修饰键只接受真正按下过的：带着修饰键标记却没有对应按键的 keydown 不响应 */
const isModifier = (key: string) => key === 'Meta' || key === 'Control' || key === 'Shift' || key === 'Alt';

/** 弹窗打开时交给弹窗自己处理；Esc 逐层退出，其余是列表上的常用快捷键 */
export const useShortcuts = (options: ShortcutOptions) => {
  /** 由按键事件维护的按下状态 */
  const pressed = new Set<string>();
  const modifierHeld = () => pressed.has('Meta') || pressed.has('Control');

  const onKeyUp = (event: KeyboardEvent) => {
    pressed.delete(event.key);
  };

  /** 失焦后收不到 keyup，状态一律作废 */
  const onBlur = () => pressed.clear();

  const onKeyDown = (event: KeyboardEvent) => {
    if (isModifier(event.key)) pressed.add(event.key);
    // 标签切走后监听仍在，v-window-item 只做 v-show；此时按键属于终端等其它面板
    if (!options.root.value?.offsetParent || options.blocked()) return;

    if (event.key === 'Escape') {
      if (options.closeMenu()) return;
      if (options.multiSelectMode.value) options.clearSelection();
      return;
    }

    if (isTyping(event.target)) return;

    const selected = options.selectedEntries.value;
    const single = selected.length === 1 ? selected[0] : null;

    const held = modifierHeld();
    if (held && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      options.selectAll();
      return;
    }
    // 复制与剪切作用于选区，粘贴落在当前目录
    if (held) {
      const key = event.key.toLowerCase();
      if (key === 'c' && selected.length) {
        event.preventDefault();
        options.copySelection();
        return;
      }
      if (key === 'x' && selected.length) {
        event.preventDefault();
        options.cutSelection();
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        options.paste();
        return;
      }
    }
    if (event.key === 'Delete' && selected.length) {
      event.preventDefault();
      options.askDelete(selected);
      return;
    }
    if (event.key === 'F2' && single) {
      event.preventDefault();
      options.openRename(single);
      return;
    }
    if (event.key === 'Enter' && single) {
      event.preventDefault();
      if (single.isDirectory) options.openDirectory(single);
      else options.openPreview(single);
      return;
    }
    if (event.key === 'Backspace' || (event.key === 'ArrowUp' && event.altKey)) {
      event.preventDefault();
      options.goUp();
    }
  };

  return { onKeyDown, onKeyUp, onBlur };
};
