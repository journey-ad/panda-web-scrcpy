import { nextTick, ref, type Ref } from 'vue';

import { isDirectory } from '../device/fs';
import { failText } from '../model/errors';

interface PathBarOptions {
  currentPath: Ref<string>;
  breadcrumbs: Ref<{ name: string; path: string }[]>;
  navigate: (path: string) => void;
  notify: (text: string, type?: 'error' | 'success') => void;
}

/**
 * 地址栏：面包屑点击与手输路径
 * 点空白处或当前这一段进入编辑态，回车跳转
 */
export const usePathBar = (options: PathBarOptions) => {
  const { currentPath, breadcrumbs, navigate, notify } = options;
  const editingPath = ref(false);
  const pathInput = ref('');
  const pathField = ref<HTMLInputElement | null>(null);

  const startEditingPath = () => {
    pathInput.value = currentPath.value;
    editingPath.value = true;
    void nextTick(() => {
      pathField.value?.focus();
      pathField.value?.select();
    });
  };

  /** 输入框里手动输入的路径先归一化，多余与结尾的斜杠都去除 */
  const submitPath = async () => {
    const parts = pathInput.value.trim().split('/').filter(Boolean);
    const target = parts.length ? `/${parts.join('/')}` : '/';
    if (target === currentPath.value) {
      editingPath.value = false;
      return;
    }
    // 先确认目标存在再进入，输入有误时留在当前目录并保持编辑态
    try {
      if (!(await isDirectory(target))) {
        notify(`路径不存在或不是目录：${target}`, 'error');
        return;
      }
    } catch (error) {
      notify(failText('跳转', error), 'error');
      return;
    }
    editingPath.value = false;
    navigate(target);
  };

  const onCrumbClick = (crumb: { path: string }, index: number) => {
    // 最后一段就是当前目录，再点它没有目标路径，改为进入编辑态
    if (index === breadcrumbs.value.length - 1) {
      startEditingPath();
      return;
    }
    navigate(crumb.path);
  };

  const onCrumbAreaClick = (event: MouseEvent) => {
    // 落在具体某一段上由它自己处理，其余空白与分隔符都进编辑态
    if ((event.target as HTMLElement).closest('.fm-crumb')) return;
    startEditingPath();
  };

  /** 列表的 mousedown 会 preventDefault，输入框不触发 blur，落点判定放在捕获阶段 */
  const onOutsideMouseDown = (event: MouseEvent) => {
    if (!editingPath.value || pathField.value?.contains(event.target as Node)) return;
    editingPath.value = false;
  };

  return {
    editingPath,
    pathInput,
    pathField,
    startEditingPath,
    submitPath,
    onCrumbClick,
    onCrumbAreaClick,
    onOutsideMouseDown,
  };
};
