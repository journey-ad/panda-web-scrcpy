import { onUnmounted, ref } from 'vue';

import { errorText } from '../../shared/utils';

/**
 * 预览组件的公共生命周期
 * 各类型的加载过程不同，但"卸载后停止上报错误""失败统一转成提示"这两件事一致，因此收敛在这里
 */
export const usePreviewScope = (onError: (message: string) => void) => {
  const loading = ref(true);
  const controller = new AbortController();
  const { signal } = controller;
  let disposed = false;
  onUnmounted(() => {
    disposed = true;
    controller.abort();
  });

  /** 读取在设备侧，返回时组件可能已经关闭 */
  const done = () => disposed;
  const fail = (error: unknown) => {
    if (!disposed) onError(errorText(error));
  };
  const stop = () => {
    if (!disposed) loading.value = false;
  };

  return { loading, signal, done, fail, stop };
};
