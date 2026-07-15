<template>
    <button class="dd-icon-btn" @click="guideDialogVisible = true" title="帮助文档">
        <v-icon size="18" :icon="mdiHelpCircleOutline" />
    </button>

    <v-dialog v-model="guideDialogVisible" max-width="560">
        <div class="guide-dialog">
            <div class="gd-header">
                <span class="gd-title">添加设备指南</span>
                <button class="gd-close" @click="guideDialogVisible = false">
                    <v-icon size="18" :icon="mdiClose" />
                </button>
            </div>

            <div class="gd-body">
                <p class="gd-section-label">步骤说明</p>
                <ol class="gd-steps">
                    <li v-for="(step, index) in allSteps" :key="index" class="gd-step">
                        <strong>{{ step.title }}</strong>
                        <span>{{ step.content }}</span>
                    </li>
                </ol>

                <details class="gd-faq">
                    <summary class="gd-faq-toggle">常见问题 (FAQ)</summary>
                    <div class="gd-faq-list">
                        <div v-for="(item, index) in faqItems" :key="index" class="gd-faq-item">
                            <strong>{{ item.question }}</strong>
                            <p>{{ item.answer }}</p>
                        </div>
                    </div>
                </details>
            </div>

            <div class="gd-actions">
                <v-btn size="small" color="primary" @click="guideDialogVisible = false">
                    完成
                </v-btn>
            </div>
        </div>
    </v-dialog>
</template>

<script setup>
import { mdiClose, mdiHelpCircleOutline } from '@mdi/js'

import { ref, computed } from 'vue';

const guideDialogVisible = ref(false);

const developerSteps = [
    { title: '打开设置', content: '进入您手机的设置应用' },
    { title: '找到"关于手机"', content: '滚动到设置底部，点击"关于手机"或"关于设备"' },
    { title: '点击"版本号"', content: '连续点击"版本号"或"构建号码"7次，直到看到"您已成为开发者"的提示' },
    { title: '返回设置', content: '返回到主设置页面，您应该能看到新的"开发者选项"菜单' },
];

const connectionSteps = [
    { title: '开发者选项', content: '进入"开发者选项"菜单' },
    { title: '启用USB调试', content: '在开发者选项中，找到并开启"USB调试"开关' },
    { title: '确认', content: '在弹出的对话框中点击"确定"或"允许"以启用USB调试' },
    { title: '连接设备', content: '使用USB线将设备连接到电脑，并在设备上允许USB调试' },
];

const allSteps = computed(() => [...developerSteps, ...connectionSteps]);

const faqItems = [
    { question: '如何开启开发者选项？', answer: '进入"设置" > "关于手机"，然后连续点击"版本号"7次。' },
    { question: '设备未被识别怎么办？', answer: '请确保您的设备驱动已正确安装，并且USB调试模式已开启。尝试重新插拔USB线或重启设备。' },
    { question: '无法启用USB调试怎么办？', answer: '某些设备可能需要额外的步骤。请查看您设备的具体说明或联系设备制造商获取帮助。' },
    { question: '连接设备后没有反应怎么办？', answer: '请检查您的USB线是否支持数据传输。某些USB线只能充电，无法传输数据。尝试使用其他USB线或端口。' },
];
</script>

<style scoped>
.dd-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    color: rgba(24, 24, 27, 0.5);
    transition: background 0.15s;
}

.dd-icon-btn:hover {
    background: rgba(24, 24, 27, 0.06);
}

.guide-dialog {
    background: rgb(var(--v-theme-surface));
    border-radius: 12px;
    overflow: hidden;
}

.gd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 0;
}

.gd-title {
    font-size: 15px;
    font-weight: 600;
    color: rgba(24, 24, 27, 0.85);
}

.gd-close {
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

.gd-close:hover {
    background: rgba(24, 24, 27, 0.06);
}

.gd-body {
    padding: 16px 20px;
}

.gd-section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: rgba(24, 24, 27, 0.4);
    letter-spacing: 0.04em;
    margin: 0 0 10px;
}

.gd-steps {
    list-style: decimal;
    padding-left: 20px;
    margin: 0 0 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.gd-step {
    font-size: 13px;
    color: rgba(24, 24, 27, 0.7);
    line-height: 1.5;
}

.gd-step strong {
    color: rgba(24, 24, 27, 0.85);
    font-weight: 600;
    margin-right: 4px;
}

.gd-faq {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
}

.gd-faq-toggle {
    padding: 10px 14px;
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.7);
    cursor: pointer;
    user-select: none;
}

.gd-faq-toggle:hover {
    background: rgba(24, 24, 27, 0.02);
}

.gd-faq-list {
    padding: 0 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.gd-faq-item {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(24, 24, 27, 0.6);
}

.gd-faq-item strong {
    display: block;
    color: rgba(24, 24, 27, 0.8);
    font-weight: 500;
    margin-bottom: 2px;
}

.gd-faq-item p {
    margin: 0;
}

.gd-actions {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
}
</style>
