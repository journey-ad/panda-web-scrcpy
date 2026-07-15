<template>
  <div class="welcome">
    <div class="welcome-inner">
      <v-img :src="logo" width="40" height="40" class="mb-3" contain alt="" />
      <p class="brand-label">PANDASCRCPY</p>

      <p class="welcome-hint">连接设备后即可在左侧控制</p>

      <div class="shortcut-list">
        <div
          v-for="(cmd, i) in commands"
          :key="i"
          class="shortcut-row"
        >
          <span class="shortcut-text">{{ cmd.text }}</span>
          <span class="shortcut-keys">
            <kbd v-for="(k, j) in cmd.keys" :key="j" class="key">{{ k }}</kbd>
          </span>
        </div>
      </div>

      <a
        class="cta-banner"
        href="https://www.pandatest.net/device"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="cta-badge">免费</span>
        <span class="cta-text">
          <strong>功能加强版</strong>
          <small>AI 助手 · 虚拟屏幕 · 设备群控 · 脚本录制回放 · 性能检测等功能，免费使用</small>
        </span>
        <v-icon size="16" class="cta-arrow" :icon="mdiArrowRight" />
      </a>
    </div>
  </div>
</template>

<script setup>
import { mdiArrowRight } from '@mdi/js'

import logo from '../assets/logo.svg';

const commands = [
  { text: '粘贴到设备', keys: ['⌘', 'V'] },
  { text: '同上 (Win)', keys: ['Ctrl', 'V'] },
  { text: '画面内滚动', keys: ['滚轮'] },
];
</script>

<style scoped>
.welcome {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
}

.welcome-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 360px;
  width: 100%;
}

.brand-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(24, 24, 27, 0.4);
  margin: 0 0 16px;
}

.welcome-hint {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 20px;
}

.shortcut-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.shortcut-text {
  font-size: 13px;
  color: rgba(24, 24, 27, 0.65);
}

.shortcut-keys {
  display: flex;
  gap: 4px;
}

.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  color: rgba(24, 24, 27, 0.55);
  border: 1px solid var(--border);
  background: rgba(24, 24, 27, 0.02);
  border-radius: 6px;
}

.cta-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--cta-bg);
  text-decoration: none;
  color: #fff;
  transition: all 0.2s ease;
}

.cta-banner:hover {
  background: var(--cta-hover);
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.25);
  transform: translateY(-1px);
}

.cta-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.2);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.cta-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  line-height: 1.3;
}

.cta-text strong {
  font-weight: 600;
}

.cta-text small {
  font-size: 11px;
  opacity: 0.75;
}

.cta-arrow {
  flex-shrink: 0;
  opacity: 0.7;
}
</style>
