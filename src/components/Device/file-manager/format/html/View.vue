<script setup lang="ts">
import { mdiCodeTags, mdiEyeOutline } from '@mdi/js';
import { computed, ref, watch } from 'vue';

import { highlightLines } from '../highlight';
import { deviceFileBase, ensureDeviceFileService } from '../../device/device-file';
import { decodeText } from '../../shared/encoding';
import { readEntry } from '../../service/readEntry';
import { useSettings } from '../../shared/settings';
import { useHeadActions } from '../../ui/preview/useHeadActions';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';
import { parentPath } from '../../shared/utils';
import CodeLines from '../../ui/preview/CodeLines.vue';
import EncodingMenu from '../../ui/preview/EncodingMenu.vue';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { signal, done, fail } = usePreviewScope((message) => emit('error', message));

const prefs = useSettings();
const headActions = useHeadActions();

/** 编码只在本次预览内有效，换文件时随组件一起重建 */
const encoding = ref<string | null>(null);
const detected = ref('');

/** 关掉时交给 iframe 渲染 */
const sourceOn = ref(false);

/**
 * 设备上的 HTML 由 iframe 渲染，脚本照常执行；页面里的请求交给 Service Worker
 * 拦截到设备文件系统上，见 public/sw.js
 *
 * sandbox 必须给 allow-same-origin：没有它文档是不透明源，不受 Service Worker 控制，
 * 预览里的相对资源都无法获取；代价是文档与宿主同源，导航、弹窗、下载仍由 sandbox 阻止
 */
const doc = ref('');
const text = ref('');
/** 高亮后的源码，超过上限时为空，模板退回原文 */
const code = ref<string[]>([]);
const progress = ref(0);

/** 超过这个体积不做高亮，直接显示原文 */
const HIGHLIGHT_MAX = 1024 * 1024;

/** 源码的字号跟文本、代码预览一致 */
const sourceStyle = computed(() => ({
  fontSize: `${prefs.textFontSize}px`,
  lineHeight: `${Math.round((prefs.textFontSize * 19) / 12)}px`,
}));

let bytes: Uint8Array | null = null;
/** 相对资源的基准地址，Service Worker 不可用时为空 */
let base = '';

/**
 * 注入 <base> 指向该 HTML 所在的设备目录，文档自带 <base> 时保持原样
 */
const withBase = (html: string) => {
  if (!base || /<base[\s>]/i.test(html)) return html;
  const tag = `<base href="${base}">`;
  const match = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  if (!match) return tag + html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + tag + html.slice(at);
};

/** srcdoc 按字符串解析，文档里的 meta charset 不会再生效，编码由这里指定 */
const render = () => {
  if (!bytes) return;
  const { encoding: used, text: raw } = decodeText(bytes, encoding.value);
  detected.value = used;
  if (done()) return;
  text.value = raw;
  doc.value = withBase(raw);
  code.value = props.entry.size > HIGHLIGHT_MAX ? [] : highlightLines(raw, 'xml');
};

const load = async () => {
  const { entry } = props;
  // Service Worker 注册与文件读取并行，首屏加载无需等待注册完成
  const service = ensureDeviceFileService();
  try {
    bytes = await readEntry(entry, { signal, onProgress: (value) => (progress.value = value) });
    if (done()) return;
    const scope = await service;
    if (done()) return;
    base = scope ? deviceFileBase(scope, parentPath(entry.path)) : '';
    render();
  } catch (error) {
    fail(error);
  }
};

load();

watch(encoding, () => render());
</script>

<template>
  <!-- 编码菜单 -->
  <EncodingMenu v-model="encoding" :detected="detected" />

  <Teleport v-if="headActions && text" :to="headActions">
    <v-btn
      class="preview-head-action"
      icon
      size="small"
      variant="text"
      :title="sourceOn ? '查看渲染结果' : '查看源码'"
      @click="sourceOn = !sourceOn"
    >
      <v-icon size="18" :icon="sourceOn ? mdiEyeOutline : mdiCodeTags" />
    </v-btn>
  </Teleport>

  <div v-if="sourceOn && text" class="preview-source-wrap">
    <CodeLines v-if="code.length" :style="sourceStyle" :lines="code" />
    <pre v-else class="preview-source" :style="sourceStyle">{{ text }}</pre>
  </div>
  <iframe
    v-else-if="doc"
    :srcdoc="doc"
    sandbox="allow-scripts allow-same-origin"
    class="preview-frame"
    title="HTML 预览"
  />
  <div v-else class="preview-hint">正在加载 {{ Math.round(progress * 100) }}%</div>
</template>

<style scoped>
.preview-frame {
  align-self: stretch;
  width: 100%;
  height: 100%;
  border: none;
}

.preview-source-wrap {
  align-self: stretch;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.preview-source {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 2px 4px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 19px;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
