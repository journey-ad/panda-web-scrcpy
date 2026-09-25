import { ref, watch, type Ref } from 'vue';

import { failText } from '../model/errors';
import type { FileEntry } from '../model/types';
import { BUSY_HINT } from './useFileTasks';

interface ExtractOptions {
  currentPath: Ref<string>;
  /** 有传输任务正在进行时不发起解压 */
  hasTask: () => boolean;
  extract: (entry: FileEntry, target: string, fallback: () => Promise<boolean>) => Promise<void>;
  notify: (text: string, type?: 'error' | 'success') => void;
}

/** 解压的确认流程：先弹一次确认，设备端失败后再问是否改用浏览器内解压 */
export const useExtractFlow = (options: ExtractOptions) => {
  const { notify } = options;
  const dialog = ref(false);
  const entry = ref<FileEntry | null>(null);
  const busy = ref(false);
  const fallback = ref(false);

  let settleFallback: ((ok: boolean) => void) | null = null;

  const ask = (target: FileEntry) => {
    entry.value = target;
    dialog.value = true;
  };

  const confirmFallback = () => {
    fallback.value = true;
    return new Promise<boolean>((resolve) => {
      settleFallback = resolve;
    });
  };

  const resolveFallback = (ok: boolean) => {
    fallback.value = false;
    settleFallback?.(ok);
    settleFallback = null;
  };

  // 弹窗被遮罩点击或 Esc 关闭时 v-model 直接置 false，不会经过 resolveFallback，
  // 这里把悬而未决的确认结算掉，否则 confirmFallback 返回的 Promise 永不 settle，解压流程卡死
  watch(fallback, (visible) => {
    if (!visible) settleFallback?.(false);
  });

  const confirm = async () => {
    const target = entry.value;
    if (!target || busy.value) return;
    if (options.hasTask()) {
      notify(BUSY_HINT, 'error');
      return;
    }
    busy.value = true;
    dialog.value = false;
    try {
      await options.extract(target, options.currentPath.value, confirmFallback);
    } catch (error) {
      notify(failText('解压', error), 'error');
    } finally {
      busy.value = false;
    }
  };

  return { dialog, entry, busy, fallback, ask, confirm, resolveFallback };
};
