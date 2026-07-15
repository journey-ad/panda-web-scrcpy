<script setup lang="ts">
import { mdiArrowLeft, mdiBellOutline, mdiCameraOutline, mdiCircleOutline, mdiEyeOffOutline, mdiEyeOutline, mdiFullscreen, mdiFullscreenExit, mdiPowerStandby, mdiRadioboxMarked, mdiScreenRotation, mdiSquareOutline, mdiStopCircle, mdiVolumeMinus, mdiVolumePlus } from '@mdi/js'

import { computed, ref, onMounted, onUnmounted } from 'vue';
import { AndroidKeyCode, AndroidKeyEventAction, AndroidScreenPowerMode } from '@yume-chan/scrcpy';
import state from '../Scrcpy/scrcpy-state';
import client from '../Scrcpy/adb-client';
import recorder from '../Scrcpy/recorder';
import { saveAs } from 'file-saver';

const props = defineProps({
    direction: {
        type: String,
        default: 'vertical',
        validator: (value) => ['vertical', 'horizontal'].includes(value),
    },
});

function formatDateTime(date) {
    const pad = (num) => String(num).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    return `${year}${month}${day}_${hour}${minute}${second}`;
}

const className = computed(() => (props.direction === 'horizontal' ? 'flex-row' : 'flex-column'));

const isFullscreen = ref(false);
const isScreenOn = ref(true);
const isExpandNotificationPanel = ref(false);
const isRecording = ref(false);
const recordingTime = ref('00:00:00');

let unsubscribe = null;

onMounted(() => {
    unsubscribe = recorder.onStateChange((state) => {
        isRecording.value = state.isRecording;
        recordingTime.value = state.currentTime;
    });
});

onUnmounted(() => {
    if (unsubscribe) {
        unsubscribe();
    }
});

async function takeScreenshot() {
    if (!state.decoder) {
        console.error('截图失败: 解码器不可用');
        return;
    }

    try {
        const timestamp = formatDateTime(new Date());
        const deviceName = client.deviceName?.replace(/[^a-zA-Z0-9-_]/g, '_') || 'device';
        const fileName = `screenshot_${deviceName}_${timestamp}.png`;

        const blob = await state.decoder.snapshot();
        if (blob) {
            saveAs(blob, fileName);
        } else {
            console.error('截图失败: 没有可用的视频帧');
        }
    } catch (error) {
        console.error('截图保存失败:', error);
    }
}

function recording() {
    state.fullScreenContainer.focus();
    try {
        if (isRecording.value) {
            recorder.stopRecording();
        } else {
            if (!recorder.canRecord) {
                console.error('Cannot start recording: video metadata is not set');
                return;
            }
            recorder.startRecording();
            state.scrcpy.controller.resetVideo();
        }
    } catch (error) {
        console.error('录制操作失败:', error);
    }
}

document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement;
});

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        state.fullScreenContainer.requestFullscreen().catch((err) => {
            console.error(`无法进入全屏模式: ${err.message}`);
        });
        const canvas = state.getCanvas();
        canvas.style.height = '100%';
        canvas.style.width = 'auto';
    } else {
        document.exitFullscreen();
    }
    isFullscreen.value = !isFullscreen.value;
}

async function toggleScreen() {
    state.fullScreenContainer.focus();
    try {
        if (isScreenOn.value) {
            await state.scrcpy.controller.setScreenPowerMode(AndroidScreenPowerMode.Off);
        } else {
            await state.scrcpy.controller.setScreenPowerMode(AndroidScreenPowerMode.Normal);
        }
        isScreenOn.value = !isScreenOn.value;
    } catch (err) {
        console.error(`切换屏幕状态时出错: ${err.message}`);
    }
}

const volumeUp = async () => {
    state.fullScreenContainer.focus();
    await state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: AndroidKeyCode.VolumeUp,
        repeat: 0,
        metaState: 0,
    });
    await state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.VolumeUp,
        repeat: 0,
        metaState: 0,
    });
};

const volumeDown = async () => {
    state.fullScreenContainer.focus();
    await state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: AndroidKeyCode.VolumeDown,
        repeat: 0,
        metaState: 0,
    });
    await state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.VolumeDown,
        repeat: 0,
        metaState: 0,
    });
};

const rotateDevice = () => {
    state.fullScreenContainer.focus();
    state.scrcpy.controller.rotateDevice();
};

async function notificationPanel() {
    state.fullScreenContainer.focus();
    try {
        if (!isExpandNotificationPanel.value) {
            await state.scrcpy.controller.expandNotificationPanel();
        } else {
            await state.scrcpy.controller.collapseNotificationPanel();
        }
        isExpandNotificationPanel.value = !isExpandNotificationPanel.value;
    } catch (err) {
        console.error(`展开/收起通知面板时出错: ${err.message}`);
    }
}

function handlePointerDown(e) {
    if (!state.scrcpy) return false;
    if (e.button !== 0) return false;
    state?.fullScreenContainer.focus();
    e.preventDefault();
    e.stopPropagation();
    return true;
}

function handlePointerUp(e) {
    if (!state.scrcpy) return false;
    return e.button === 0;
}

function handleBackPointerDown(e) {
    if (!handlePointerDown(e)) return;
    state.scrcpy.controller.backOrScreenOn(AndroidKeyEventAction.Down);
}

function handleBackPointerUp(e) {
    if (!handlePointerUp(e)) return;
    state.scrcpy.controller.backOrScreenOn(AndroidKeyEventAction.Up);
}

function handleHomePointerDown(e) {
    if (!handlePointerDown(e)) return;
    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: AndroidKeyCode.AndroidHome,
        repeat: 0,
        metaState: 0,
    });
}

function handleHomePointerUp(e) {
    if (!handlePointerUp(e)) return;
    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.AndroidHome,
        repeat: 0,
        metaState: 0,
    });
}

function handleAppSwitchPointerDown(e) {
    if (!handlePointerDown(e)) return;
    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: AndroidKeyCode.AndroidAppSwitch,
        repeat: 0,
        metaState: 0,
    });
}

function handleAppSwitchPointerUp(e) {
    if (!handlePointerUp(e)) return;
    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.AndroidAppSwitch,
        repeat: 0,
        metaState: 0,
    });
}

type ToolbarButton = {
    icon: string;
    label: string;
    onClick: () => void;
    size?: string;
    isActive?: boolean;
};

const buttons = computed((): ToolbarButton[] => [
    { icon: mdiCameraOutline, label: '截图', onClick: takeScreenshot },
    {
        icon: isRecording.value ? mdiStopCircle : mdiRadioboxMarked,
        label: isRecording.value ? `录制中 ${recordingTime.value}` : '录制',
        onClick: recording,
        isActive: isRecording.value,
    },
    {
        icon: isFullscreen.value ? mdiFullscreenExit : mdiFullscreen,
        label: '全屏',
        onClick: toggleFullScreen,
    },
    {
        icon: isScreenOn.value ? mdiEyeOutline : mdiEyeOffOutline,
        label: '隐私模式',
        onClick: toggleScreen,
    },
    { icon: mdiScreenRotation, label: '旋转', size: '16', onClick: rotateDevice },
    { icon: mdiBellOutline, label: '通知栏', onClick: notificationPanel },
    { icon: mdiVolumePlus, label: '音量 + ', onClick: volumeUp },
    { icon: mdiVolumeMinus, label: '音量 -', onClick: volumeDown },
    {
        icon: mdiPowerStandby,
        label: '电源',
        onClick: () => client.device?.power?.powerButton(),
    },
]);
</script>

<template>
    <div class="nav-root">
        <slot />

        <div class="toolbar-wrap">
            <div class="toolbar" tabindex="1" :class="className">
                <button
                    v-for="(button, index) in buttons"
                    :key="index"
                    class="tb-btn"
                    :class="{ 'tb-btn--active': button.isActive }"
                    :title="button.label"
                    @click="button.onClick"
                >
                    <v-icon
                        :icon="button.icon"
                        :color="button.isActive ? '#ef4444' : undefined"
                        :size="button.size || '18'"
                    />
                </button>

                <span class="tb-sep" />

                <button
                    class="tb-btn"
                    title="返回"
                    @mousedown="handleBackPointerDown"
                    @mouseup="handleBackPointerUp"
                >
                    <v-icon size="18" :icon="mdiArrowLeft" />
                </button>

                <button
                    class="tb-btn"
                    title="桌面"
                    @mousedown="handleHomePointerDown"
                    @mouseup="handleHomePointerUp"
                >
                    <v-icon size="18" :icon="mdiCircleOutline" />
                </button>

                <button
                    class="tb-btn"
                    title="菜单"
                    @mousedown="handleAppSwitchPointerDown"
                    @mouseup="handleAppSwitchPointerUp"
                >
                    <v-icon size="18" :icon="mdiSquareOutline" />
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.nav-root {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.toolbar-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
}

.toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
}

.tb-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: rgba(24, 24, 27, 0.7);
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
    padding: 0;
}

.tb-btn:hover {
    background: rgba(24, 24, 27, 0.06);
}

.tb-btn:active {
    background: rgba(24, 24, 27, 0.1);
}

.tb-btn--active {
    background: rgba(239, 68, 68, 0.08);
}

.tb-sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
}

.flex-column {
    flex-direction: column;
}

.flex-column .tb-sep {
    width: 20px;
    height: 1px;
    margin: 4px 0;
}

.flex-row {
    flex-direction: row;
}
</style>
