<script setup lang="ts">
import { computed, ref } from 'vue';

import { GRID_MAX_COLS, GRID_MIN_COLS, TEXT_SIZES, resetSettings, useSettings } from '../shared/settings';

const prefs = useSettings();

const open = defineModel<boolean>({ required: true });

/** 恢复默认前先弹确认，确认后才执行重置 */
const confirmReset = ref(false);

const applyReset = () => {
  resetSettings();
  confirmReset.value = false;
};

/** 各选项与 settings 直接双向绑定，改动即时生效，落盘由 settings 的侦听完成 */

const sortOrder = computed({
  get: () => (prefs.sortAsc ? 'asc' : 'desc'),
  set: (value: string) => {
    prefs.sortAsc = value === 'asc';
  },
});

/** 面板滑块与底栏保持同一语义：自左向右图标由小到大，列数随之相反 */
const gridSize = computed({
  get: () => GRID_MIN_COLS + GRID_MAX_COLS - prefs.gridCols,
  set: (value: number) => {
    prefs.gridCols = GRID_MIN_COLS + GRID_MAX_COLS - value;
  },
});

/** 字号项的展示文字带单位，取值仍是设置里的数值 */
const sizeItems = computed(() => TEXT_SIZES.map((size) => ({ title: `${size} px`, value: size })));
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card>
      <v-card-title>外观设置</v-card-title>
      <v-card-text>
        <div class="ap-group">视图</div>
        <div class="ap-row">
          <span class="ap-label">视图模式</span>
          <v-btn-toggle v-model="prefs.viewMode" density="compact" variant="outlined" divided mandatory>
            <v-btn value="list" size="small">列表</v-btn>
            <v-btn value="grid" size="small">网格</v-btn>
          </v-btn-toggle>
        </div>

        <template v-if="prefs.viewMode === 'grid'">
          <div class="ap-group">网格</div>
          <div class="ap-row">
            <span class="ap-label">图标大小</span>
            <div class="ap-slider">
              <input
                v-model.number="gridSize"
                type="range"
                class="ap-range"
                :min="GRID_MIN_COLS"
                :max="GRID_MAX_COLS"
                step="1"
                aria-label="图标大小"
              />
              <span class="ap-value">每行 {{ prefs.gridCols }} 项</span>
            </div>
          </div>
          <div class="ap-row">
            <span class="ap-label">项目边框</span>
            <v-switch v-model="prefs.gridShowBorder" density="compact" hide-details color="primary" inset />
          </div>
          <div class="ap-row">
            <span class="ap-label">缩略图</span>
            <v-switch v-model="prefs.gridShowThumbnails" density="compact" hide-details color="primary" inset />
          </div>
          <div class="dialog-note">关掉缩略图后统一显示类型图标，大目录打开更快</div>
        </template>

        <template v-else>
          <div class="ap-group">列表</div>
          <div class="ap-row">
            <span class="ap-label">行间分隔线</span>
            <v-switch v-model="prefs.listShowDivider" density="compact" hide-details color="primary" inset />
          </div>
          <div class="ap-row">
            <span class="ap-label">显示详情行</span>
            <v-switch v-model="prefs.listShowMeta" density="compact" hide-details color="primary" inset />
          </div>
        </template>

        <div class="ap-group">预览</div>
        <div class="ap-row">
          <span class="ap-label">预览窗口全屏</span>
          <v-switch v-model="prefs.previewFullscreen" density="compact" hide-details color="primary" inset />
        </div>
        <div class="ap-row">
          <span class="ap-label">文本预览字号</span>
          <v-select
            v-model="prefs.textFontSize"
            :items="sizeItems"
            density="compact"
            variant="outlined"
            hide-details
            class="ap-select"
            aria-label="文本预览字号"
          />
        </div>
        <div class="dialog-note">字号作用于文本、代码、Markdown、JSON 与表格预览</div>

        <div class="ap-group">排序</div>
        <div class="ap-row">
          <span class="ap-label">排序</span>
          <div class="ap-controls">
            <v-btn-toggle v-model="prefs.sortKey" density="compact" variant="outlined" divided mandatory>
              <v-btn value="name" size="small">名称</v-btn>
              <v-btn value="mtime" size="small">修改时间</v-btn>
            </v-btn-toggle>
            <v-btn-toggle v-model="sortOrder" density="compact" variant="outlined" divided mandatory>
              <v-btn value="asc" size="small">升序</v-btn>
              <v-btn value="desc" size="small">降序</v-btn>
            </v-btn-toggle>
          </div>
        </div>

        <div class="ap-group">操作</div>
        <div class="ap-row">
          <span class="ap-label">拖拽移动前确认</span>
          <v-switch v-model="prefs.confirmMove" density="compact" hide-details color="primary" inset />
        </div>

        <div class="dialog-note">改动即时生效，保存在本机浏览器里</div>
      </v-card-text>
      <v-card-actions class="ap-actions">
        <v-spacer />
        <v-btn size="small" variant="text" color="secondary" @click="confirmReset = true">恢复默认</v-btn>
        <v-btn size="small" variant="flat" color="primary" @click="open = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="confirmReset" max-width="400">
    <v-card>
      <v-card-title>恢复默认设置</v-card-title>
      <v-card-text>全部外观设置会立即恢复到默认值</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn size="small" variant="text" color="secondary" @click="confirmReset = false">取消</v-btn>
        <v-btn size="small" variant="flat" color="primary" @click="applyReset">恢复默认</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ap-group {
  margin-bottom: 2px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.5);
}

.ap-group,
.ap-row,
.dialog-note {
  animation: ap-enter 0.14s ease-out;
}

@keyframes ap-enter {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ap-group,
  .ap-row,
  .dialog-note {
    animation: none;
  }
}

.ap-group:not(:first-child) {
  margin-top: 14px;
}

.ap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
}

.ap-row + .ap-row {
  margin-top: 4px;
}

.ap-label {
  font-size: 13px;
  color: rgba(24, 24, 27, 0.8);
}

.ap-slider {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ap-range {
  width: 120px;
  accent-color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

.ap-value {
  font-size: 12px;
  color: var(--muted);
  text-align: right;
  white-space: nowrap;
}

.ap-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ap-select {
  flex: 0 0 108px;
  max-width: 108px;
}

.ap-select :deep(.v-field) {
  min-height: 30px;
  font-size: 13px;
}

.ap-select :deep(.v-field__input) {
  min-height: 30px;
  padding-top: 0;
  padding-bottom: 0;
}

.ap-row :deep(.v-switch) {
  flex: 0 0 auto;
  margin-right: -10px;
}
</style>
