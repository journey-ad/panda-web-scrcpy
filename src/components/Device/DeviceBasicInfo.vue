<template>
  <v-card class="info-card" elevation="0">
    <div class="info-card-head">
      <span class="info-card-title">设备信息</span>
    </div>
    <v-card-text class="info-card-body pa-0">
      <div class="info-table">
        <div class="info-item">
          <span class="info-label">品牌</span>
          <span class="info-value">{{ deviceInfo.brand }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">型号</span>
          <span class="info-value">{{ deviceInfo.deviceModel }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">代号</span>
          <span class="info-value">{{ deviceInfo.device }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">安卓</span>
          <span class="info-value">{{ deviceInfo.androidVersion }} (SDK {{ deviceInfo.sdkVersionCode }})</span>
        </div>
        <div class="info-item">
          <span class="info-label">CPU</span>
          <span class="info-value">{{ deviceInfo.cpuAbi }} · {{ deviceInfo.cpuInfo }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">分辨率</span>
          <span class="info-value">{{ deviceInfo.resolution }} @ {{ deviceInfo.screenDensity }}dpi</span>
        </div>
        <div class="info-item">
          <span class="info-label">IP</span>
          <span class="info-value">{{ deviceInfo.ipAddress || '—' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">序列号</span>
          <span class="info-value">{{ deviceInfo.serialNumber }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Root</span>
          <span class="info-value">{{ deviceInfo.rootState }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">BL 锁</span>
          <span class="info-value">{{ bootloaderStatus }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">A/B 槽</span>
          <span class="info-value">{{ abPartitionStatus }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">闪存</span>
          <span class="info-value">{{ deviceInfo.storageType }}</span>
        </div>
        <div class="info-item info-item--span">
          <span class="info-label">连接类型</span>
          <span class="info-value">{{ usbLink }}</span>
        </div>
        <div class="info-item info-item--span">
          <span class="info-label">开机</span>
          <span class="info-value">{{ uptime }}</span>
        </div>
        <div class="info-item info-item--span">
          <span class="info-label">内核</span>
          <span class="info-value info-value--wrap">{{ deviceInfo.kernelVersion }}</span>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  deviceInfo: {
    type: Object,
    required: true
  },
  deviceMeta: {
    type: Object,
    default: undefined
  }
});

/** USB 3 的 bulk 端点 packetSize 为 1024，USB 2 为 512 及以下 */
const usbLink = computed(() => {
  const endpoints = props.deviceMeta?.raw?.configuration?.interfaces?.[0]?.alternates?.[0]?.endpoints ?? [];
  if (!endpoints.length) return '—';
  return endpoints.some((ep) => ep.packetSize <= 512) ? 'USB 2.0 · High Speed' : 'USB 3 · SuperSpeed';
});

const bootloaderStatus = computed(() => {
  if (['green'].includes(props.deviceInfo.bootloader)) {
    return 'locked';
  }
  return 'unlocked';
});

const abPartitionStatus = computed(() => {
  switch (props.deviceInfo.abPartition) {
    case '_a':
      return 'Slot A';
    case '_b':
      return 'Slot B';
    default:
      return 'Unknown';
  }
});

const formatSeconds = (seconds) => {
  const parts = [];
  const d = Math.floor(seconds / 86400);
  const h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);

  if (d) parts.push(d + '天');
  if (h) parts.push(h + '小时');
  if (m) parts.push(m + '分');
  if (s || !parts.length) parts.push(s + '秒');

  return parts.join('');
};

const uptime = computed(() => {
  const s = Number(props.deviceInfo.uptime);
  return formatSeconds(Number.isFinite(s) ? s : 0);
});
</script>

<style scoped>
.info-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--border);
  overflow: hidden;
}

.info-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.02);
}

.info-card-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(24, 24, 27, 0.88);
  letter-spacing: 0.02em;
}

.info-card-body {
  padding: 0 !important;
}

.info-table {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}

@media (min-width: 400px) {
  .info-table {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.info-item {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px 10px;
  align-items: baseline;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}

@media (min-width: 400px) {
  .info-item:nth-child(odd) {
    border-right: 1px solid var(--border);
  }
}

.info-item--span {
  grid-column: 1 / -1;
  border-right: none !important;
  grid-template-columns: 72px minmax(0, 1fr);
}

@media (max-width: 399px) {
  .info-item--span {
    grid-template-columns: 72px minmax(0, 1fr);
  }
}

.info-item:last-child {
  border-bottom: none;
}

.info-label {
  font-weight: 500;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.info-value {
  font-size: 12px;
  color: rgba(24, 24, 27, 0.88);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-value--wrap {
  white-space: normal;
  word-break: break-all;
  line-height: 1.45;
}
</style>
