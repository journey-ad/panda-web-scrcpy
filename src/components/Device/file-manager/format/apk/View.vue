<script setup lang="ts">
import { mdiAlertOutline, mdiAndroid, mdiCheckCircleOutline } from '@mdi/js';
import { escapeArg } from '@yume-chan/adb';
import { computed, onUnmounted, ref } from 'vue';

import { analyzeApk, type ApkInfo } from './parser';
import { colorOf } from '../registry';
import { extensionOf } from '../../model/mime';
import { readRange } from '../../device/device-file';
import { exec, runShell } from '../../device/fs';
import { useHeadActions } from '../../ui/preview/useHeadActions';
import { usePreviewScope } from '../../ui/preview/usePreviewScope';
import type { FileEntry } from '../../model/types';
import { errorText, formatSize } from '../../shared/utils';

const props = defineProps<{ entry: FileEntry }>();
const emit = defineEmits<{ (e: 'error', message: string): void }>();

const { done } = usePreviewScope((message) => emit('error', message));

/** 安装按钮传送到预览窗标题栏，与编码、字号选择同一排 */
const headActions = useHeadActions();

const info = ref<ApkInfo | null>(null);
const iconUrl = ref('');
/** 图标数据解不出来、或读回来的字节不是图片，都退回类型图标 */
const iconFailed = ref(false);
const failure = ref('');
const installDialog = ref(false);
/** 安装进度与结果单独一个弹窗，预览区保持原样 */
const installOpen = ref(false);
const installPhase = ref<'idle' | 'working' | 'success' | 'failure'>('idle');
const installMessage = ref('');
const installing = computed(() => installPhase.value === 'working');

/** 解析出应用名前先用文件名暂代 */
const appName = computed(() => info.value?.label || props.entry.name);


const componentSummary = (item: ApkInfo) =>
  [
    item.activities.length && `Activity ${item.activities.length}`,
    item.services.length && `Service ${item.services.length}`,
    item.receivers.length && `Receiver ${item.receivers.length}`,
    item.providers.length && `Provider ${item.providers.length}`,
  ]
    .filter(Boolean)
    .join(' · ');

const rows = computed(() => {
  const item = info.value;
  if (!item) return [];
  const sdk = [
    item.minSdk && `min ${item.minSdk}`,
    item.targetSdk && `target ${item.targetSdk}`,
    item.compileSdk && `compile ${item.compileSdk}`,
  ].filter(Boolean);
  const versions = [item.versionName, item.versionCode && `(${item.versionCode})`].filter(Boolean);
  const signature = [
    item.signatureFiles.length && 'v1',
    item.signedBlock && 'v2 / v3',
  ].filter(Boolean);

  const list = [
    { key: '版本', value: versions.join(' ') || '—' },
    { key: 'SDK', value: sdk.join(' · ') || '—' },
    { key: '体积', value: `${formatSize(props.entry.size)}（解压后 ${formatSize(item.unpackedSize)}）` },
    { key: '组件', value: componentSummary(item) || '—' },
    { key: '签名', value: signature.length ? signature.join(' · ') : '未发现签名信息' },
    { key: 'ZIP 条目', value: `${item.entryCount} 个` },
  ];
  if (item.abis.length) list.splice(4, 0, { key: '原生库', value: item.abis.join(', ') });
  return list;
});

const groups = computed(() => {
  const item = info.value;
  if (!item) return [];
  return [
    { title: 'Activity', list: item.activities },
    { title: 'Service', list: item.services },
    { title: 'Receiver', list: item.receivers },
    { title: 'Provider', list: item.providers },
  ].filter((group) => group.list.length);
});

const iconType = () => {
  const ext = extensionOf(info.value?.icon?.path ?? '');
  return ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
};

const load = async () => {
  const { entry } = props;
  try {
    const result = await analyzeApk(entry.size, (start, end) => readRange(entry.path, start, end));
    if (done()) return;
    info.value = result;
    if (result.icon) {
      iconUrl.value = URL.createObjectURL(
        new Blob([result.icon.data as BlobPart], { type: iconType() })
      );
    }
  } catch (error) {
    if (!done()) failure.value = `解析安装包失败：${errorText(error)}`;
  }
};

load();

/** pm 由 system_server 执行，无法读取外部存储上带 FUSE 上下文的文件，安装前先复制到设备临时目录 */
const TEMP_APK = '/data/local/tmp/panda-install.apk';

const inTempDir = (path: string) => path.startsWith('/data/local/tmp/');

/** 交给设备上的 pm 安装，输出里的 Success 是唯一的成功标志 */
const confirmInstall = async () => {
  installDialog.value = false;
  installOpen.value = true;
  installPhase.value = 'working';

  const source = props.entry.path;
  const target = inTempDir(source) ? source : TEMP_APK;
  installMessage.value = target === source ? '正在安装…' : '正在把安装包复制到设备临时目录…';
  try {
    if (target !== source) {
      // 设置 644 权限，使 system_server 能读取这份副本
      const copied = await runShell(
        `cat ${escapeArg(source)} > ${escapeArg(target)} && chmod 644 ${escapeArg(target)}`
      );
      if (copied.code !== 0) throw new Error(copied.output || '无法复制到 /data/local/tmp');
    }
    installMessage.value = '正在安装…';
    const result = await runShell(`pm install -r ${escapeArg(target)}`);
    if (/success/i.test(result.output)) {
      installPhase.value = 'success';
      installMessage.value = '安装成功';
      return;
    }
    installPhase.value = 'failure';
    installMessage.value = `安装失败：${result.output || '设备未返回结果'}`;
  } catch (error) {
    installPhase.value = 'failure';
    installMessage.value = `安装失败：${errorText(error)}`;
  } finally {
    // 临时副本已无用，删除失败不影响安装结果
    if (target !== source) await exec(['rm', '-f', target]).catch(() => {});
  }
};

onUnmounted(() => {
  if (iconUrl.value) URL.revokeObjectURL(iconUrl.value);
});
</script>

<template>
  <div class="preview-apk">
    <div class="apk-head">
      <img v-if="iconUrl" class="apk-icon" :src="iconUrl" alt="" @error="iconFailed = true" />
      <div v-else class="apk-icon apk-icon-default">
        <v-icon size="32" :icon="mdiAndroid" :color="colorOf(entry)" />
      </div>
      <div class="apk-titles">
        <div class="apk-name">{{ info?.label || entry.name }}</div>
        <div class="apk-package">{{ info?.packageName || entry.name }}</div>
      </div>
    </div>

    <Teleport v-if="headActions" :to="headActions">
      <v-btn
        class="preview-head-action"
        size="small"
        variant="text"
        color="primary"
        :loading="installing"
        :disabled="installing"
        title="安装到设备"
        @click="installDialog = true"
      >
        安装
      </v-btn>
    </Teleport>

    <div class="info-grid">
      <template v-for="row in rows" :key="row.key">
        <div class="info-key">{{ row.key }}</div>
        <div class="info-value" :title="row.value">{{ row.value }}</div>
      </template>
    </div>

    <template v-if="info?.permissions.length">
      <div class="apk-section">权限（{{ info.permissions.length }}）</div>
      <div class="apk-list">
        <div v-for="permission in info.permissions" :key="permission" class="apk-item">
          {{ permission }}
        </div>
      </div>
    </template>

    <template v-for="group in groups" :key="group.title">
      <div class="apk-section">{{ group.title }}（{{ group.list.length }}）</div>
      <div class="apk-list">
        <div v-for="component in group.list" :key="component.name" class="apk-item">
          <span class="apk-item-name">{{ component.name }}</span>
          <span v-if="component.launcher" class="apk-tag">启动入口</span>
          <span v-if="component.exported === 'true'" class="apk-tag">exported</span>
        </div>
      </div>
    </template>

    <div v-if="failure" class="preview-hint">{{ failure }}</div>
    <div v-else-if="!info" class="preview-hint">正在解析安装包…</div>

    <v-dialog v-model="installDialog" max-width="400">
      <v-card>
        <v-card-title>安装到设备</v-card-title>
        <v-card-text>
          <p class="apk-install-line">
            即将安装
            <strong class="apk-install-app" :title="appName">{{ appName }}</strong>
            ，安装期间请保持设备连接
          </p>
          <div class="dialog-alert">
            <v-icon size="14" :icon="mdiAlertOutline" />
            同包名的应用会被覆盖
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" color="secondary" @click="installDialog = false">取消</v-btn>
          <v-btn size="small" variant="flat" color="primary" @click="confirmInstall">安装</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="installOpen" :persistent="installing" max-width="420">
      <v-card>
        <v-card-title>{{ installing ? '正在安装' : '安装结果' }}</v-card-title>
        <v-card-text>
          <div class="apk-install-target" :title="appName">{{ appName }}</div>
          <v-progress-linear v-if="installing" indeterminate height="18" color="primary" />
          <div class="apk-install-status" :class="installPhase">
            <v-icon v-if="installPhase === 'success'" size="16" :icon="mdiCheckCircleOutline" />
            <v-icon v-else-if="installPhase === 'failure'" size="16" :icon="mdiAlertOutline" />
            <span class="apk-install-text">{{ installMessage }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            size="small"
            variant="flat"
            :color="installPhase === 'failure' ? 'secondary' : 'primary'"
            :disabled="installing"
            @click="installOpen = false"
          >
            {{ installPhase === 'success' ? '完成' : '关闭' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.preview-apk {
  align-self: stretch;
  width: 100%;
  height: 100%;
  overflow: auto;
  font-size: 12px;
}

.apk-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px 14px;
}

.apk-icon {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  object-fit: contain;
  border: 1px solid var(--border);
}

.apk-icon-default {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(24, 24, 27, 0.03);
}

.apk-titles {
  min-width: 0;
}

.apk-install-line {
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.apk-install-app {
  display: inline-block;
  max-width: 180px;
  vertical-align: bottom;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.apk-install-target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.9);
}

.apk-install-status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}

.apk-install-status.failure .apk-install-text {
  max-height: 132px;
  overflow: auto;
  word-break: break-word;
}

.apk-install-status.success {
  color: rgb(22, 163, 74);
}

.apk-install-status.failure {
  color: #dc2626;
}

.apk-name {
  font-size: 15px;
  font-weight: 500;
  color: rgba(24, 24, 27, 0.9);
  word-break: break-all;
}

.apk-package {
  margin-top: 2px;
  color: var(--muted);
  word-break: break-all;
}

.info-grid {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 4px 12px;
  padding-bottom: 8px;
}

.info-key {
  color: var(--muted);
}

.info-value {
  color: rgba(24, 24, 27, 0.9);
  word-break: break-all;
}

.apk-section {
  padding: 12px 2px 6px;
  font-weight: 500;
  color: rgba(24, 24, 27, 0.85);
}

.apk-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.03);
}

.apk-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: rgba(24, 24, 27, 0.8);
}

.apk-item-name {
  min-width: 0;
  word-break: break-all;
}

.apk-tag {
  flex-shrink: 0;
  padding: 0 4px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.7);
  color: var(--muted);
}
</style>
