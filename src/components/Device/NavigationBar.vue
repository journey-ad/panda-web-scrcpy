<script setup lang="ts">
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

// 录制状态监听
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

const buttons = ref([
    { icon: 'mdi-camera', label: '截图', onClick: () => takeScreenshot() },
    {
        icon: 'mdi-radiobox-marked',
        label: computed(() => (isRecording.value ? `录制中 ${recordingTime.value}` : '录制')),
        onClick: () => recording(),
        isActive: computed(() => isRecording.value),
    },
    {
        icon: computed(() => (isFullscreen.value ? 'mdi-fullscreen-exit' : 'mdi-fullscreen')),
        label: '全屏',
        onClick: () => toggleFullScreen(),
    },
    {
        icon: computed(() => (isScreenOn.value ? 'mdi-eye-outline' : 'mdi-eye-closed')),
        label: '隐私模式',
        onClick: () => toggleScreen(),
    },
    { icon: 'mdi-screen-rotation', label: '旋转', size: '18', onClick: () => rotateDevice() },
    {
        icon: 'mdi-bell-cog-outline',
        label: '通知栏',
        onClick: () => notificationPanel(),
    },
    { icon: 'mdi-volume-plus', label: '音量 + ', onClick: () => volumeUp() },
    { icon: 'mdi-volume-minus', label: '音量 -', onClick: () => volumeDown() },
    {
        icon: 'mdi-power-standby',
        label: '电源',
        onClick: () => client.device.power.powerButton(),
    },
]);

async function takeScreenshot() {
    if(!client.device) return;

    try {
        const timestamp = formatDateTime(new Date());
        const deviceName = client.deviceName?.replace(/[^a-zA-Z0-9-_]/g, '_') || 'device';
        const fileName = `screenshot_${deviceName}_${timestamp}.png`;

        // 执行screencap命令并保存到/tmp/screenshot.png
        await client.device.subprocess.noneProtocol!.spawnWait([
            'screencap',
            '-p',
            '/tmp/screenshot.png'
        ]);

        // 从/tmp/screenshot.png读取并保存为文件
        const tempFile = `/tmp/screenshot.png`;
        const sync = await client.device.sync();
        try {
            const stream = await sync.read(tempFile);
            
            const reader = stream.getReader();
            const chunks: Uint8Array[] = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
            }
            
            const blob = new Blob(chunks as BlobPart[], { type: 'image/png' });
            saveAs(blob, fileName);
        } finally {
            await sync.dispose();
            await client.device.subprocess.noneProtocol!.spawnWait([
                'rm',
                tempFile
            ]);
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
            recorder.startRecording(); // 开始录制
            state.scrcpy.controller.resetVideo(); // 重置视频流以开始录制
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
    if (!state.scrcpy) {
        return false;
    }

    if (e.button !== 0) {
        return false;
    }

    state?.fullScreenContainer.focus();
    e.preventDefault();
    e.stopPropagation();

    return true;
}

function handlePointerUp(e) {
    if (!state.scrcpy) {
        return false;
    }
    return e.button === 0;
}

function handleBackPointerDown(e) {
    if (!handlePointerDown(e)) {
        return;
    }

    state.scrcpy.controller.backOrScreenOn(AndroidKeyEventAction.Down);
}

function handleBackPointerUp(e) {
    if (!handlePointerUp(e)) {
        return;
    }

    state.scrcpy.controller.backOrScreenOn(AndroidKeyEventAction.Up);
}

function handleHomePointerDown(e) {
    if (!handlePointerDown(e)) {
        return;
    }

    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: AndroidKeyCode.AndroidHome,
        repeat: 0,
        metaState: 0,
    });
}

function handleHomePointerUp(e) {
    if (!handlePointerUp(e)) {
        return;
    }

    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.AndroidHome,
        repeat: 0,
        metaState: 0,
    });
}

function handleAppSwitchPointerDown(e) {
    if (!handlePointerDown(e)) {
        return;
    }

    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode: AndroidKeyCode.AndroidAppSwitch,
        repeat: 0,
        metaState: 0,
    });
}

function handleAppSwitchPointerUp(e) {
    if (!handlePointerUp(e)) {
        return;
    }

    state.scrcpy?.controller?.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode: AndroidKeyCode.AndroidAppSwitch,
        repeat: 0,
        metaState: 0,
    });
}
</script>

<template>
    <div>
        <div>
            <slot />
        </div>

        <v-container fluid>
            <div class="d-flex align-center justify-center">
                <v-card class="control-panel px-2 py-2" elevation="3" rounded="pill">
                    <div class="d-flex align-center" tabindex="1" :class="className">
                        <v-btn
                            v-for="(button, index) in buttons"
                            :key="index"
                            :color="button.isActive ? 'error' : undefined"
                            icon
                            variant="text"
                            size="x-small"
                            class="control-btn"
                            density="compact"
                            :aria-label="
                                typeof button.label === 'function' ? button.label() : button.label
                            "
                            @click="button.onClick"
                        >
                            <v-tooltip
                                :text="
                                    typeof button.label === 'function'
                                        ? button.label()
                                        : button.label
                                "
                                location="top"
                            >
                                <template #activator="{ props }">
                                    <v-icon
                                        v-bind="props"
                                        :icon="
                                            typeof button.icon === 'function'
                                                ? button.icon()
                                                : button.icon
                                        "
                                        :color="button.isActive ? 'error' : 'black'"
                                        :size="button.size || '20px'"
                                    />
                                </template>
                            </v-tooltip>
                        </v-btn>
                        <v-divider :thickness="2" color="info" aria-orientation="horizontal" />
                        <v-btn
                            variant="text"
                            size="small"
                            class="control-btn mx-1"
                            @mousedown="handleBackPointerDown"
                            @mouseup="handleBackPointerUp"
                        >
                            <v-tooltip text="返回" location="top">
                                <template #activator="{ props }">
                                    <v-icon v-bind="props" size="20px">mdi-arrow-left</v-icon>
                                </template>
                            </v-tooltip>
                        </v-btn>

                        <v-btn
                            variant="text"
                            size="20"
                            class="control-btn mx-1"
                            @mousedown="handleHomePointerDown"
                            @mouseup="handleHomePointerUp"
                        >
                            <v-tooltip text="桌面" location="top">
                                <template #activator="{ props }">
                                    <v-icon v-bind="props">mdi-circle-outline</v-icon>
                                </template>
                            </v-tooltip>
                        </v-btn>
                        <v-btn
                            variant="text"
                            size="small"
                            class="control-btn mx-1"
                            @mousedown="handleAppSwitchPointerDown"
                            @mouseup="handleAppSwitchPointerUp"
                        >
                            <v-tooltip text="菜单" location="top">
                                <template #activator="{ props }">
                                    <v-icon v-bind="props">mdi-square-outline</v-icon>
                                </template>
                            </v-tooltip>
                        </v-btn>
                    </div>
                </v-card>
            </div>
        </v-container>
    </div>
</template>

<style scoped>
.control-panel {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
}

.control-btn {
    width:35px !important;
    min-width: 35px !important;
    height: 35px !important;
    margin: 0 2px !important;
    padding: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
}

.control-btn:hover {
    background-color: rgba(0, 0, 0, 0.04) !important;
}

.control-btn :deep(.v-icon) {
    margin: 0 !important;
    padding: 0 !important;
}

.control-btn::before {
    display: none !important;
}
</style>
