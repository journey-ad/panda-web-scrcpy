import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';

/** 预览窗标题栏里留给各类型自带按钮的位置 */
const HEAD_ACTIONS: InjectionKey<Ref<HTMLElement | null>> = Symbol('preview-head-actions');

export const provideHeadActions = (target: Ref<HTMLElement | null>) => provide(HEAD_ACTIONS, target);

/** 预览组件把自己的按钮传送到标题栏，脱离预览窗使用时无法获取位置 */
export const useHeadActions = () => inject(HEAD_ACTIONS, ref<HTMLElement | null>(null));
