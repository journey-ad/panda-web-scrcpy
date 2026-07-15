<script setup>
import { mdiCellphone, mdiClose } from '@mdi/js'

import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

const drawer = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
</script>

<template>
  <v-navigation-drawer
    v-model="drawer"
    location="top"
    temporary
    class="device-drawer"
  >
    <div class="drawer-inner">
      <div class="drawer-header">
        <span class="drawer-title">选择调试设备</span>
        <button class="drawer-close" @click="drawer = false">
          <v-icon size="18" :icon="mdiClose" />
        </button>
      </div>
      <v-alert
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4 text-body-2"
      >
        支持将本地设备快速接入平台，提供设备调试、应用管理、日志查看等功能
      </v-alert>
      <div class="drawer-empty">
        <v-icon size="32" color="secondary" class="mb-2" :icon="mdiCellphone" />
        <p class="text-body-2 text-medium-emphasis">未检测到设备</p>
        <p class="text-caption text-disabled">请确保设备已开启 USB 调试模式并连接到电脑</p>
      </div>
    </div>
  </v-navigation-drawer>
</template>

<style lang="scss" scoped>
.device-drawer {
  max-height: 50vh;
  border-radius: 0 0 12px 12px !important;
  border-bottom: 1px solid var(--border) !important;

  :deep(.v-navigation-drawer__content) {
    border-radius: 0 0 12px 12px;
    overflow: hidden;
  }
}

.drawer-inner {
  padding: 16px 20px;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.85);
}

.drawer-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(24, 24, 27, 0.4);
  cursor: pointer;
}

.drawer-close:hover {
  background: rgba(24, 24, 27, 0.06);
}

.drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0 8px;
  text-align: center;
}
</style>
