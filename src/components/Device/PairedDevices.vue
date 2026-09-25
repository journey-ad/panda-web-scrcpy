<script setup lang="ts">
import { mdiCellphone, mdiCellphoneLink, mdiCheckCircle, mdiChevronDown, mdiClose, mdiPlus, mdiWifi } from '@mdi/js'

import { ref, onMounted, shallowRef, watch, computed, onUnmounted } from 'vue';
import client, { type DeviceMeta } from '../Scrcpy/adb-client';
import { connectWifiBridge } from '../Scrcpy/wifi-connection';
import { AdbDaemonWebUsbDeviceObserver, AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';
import DeviceGuide from './DeviceGuide.vue';

const emit = defineEmits(['pair-device', 'remove-device', 'update-connection-status']);

const showDevices = ref(false);
const selected = shallowRef<AdbDaemonWebUsbDevice | undefined>(undefined);
const usbDeviceList = shallowRef<AdbDaemonWebUsbDevice[]>([]);
const watcher = shallowRef<AdbDaemonWebUsbDeviceObserver | null>(null);
const errorMessage = ref('');
const errorDetails = ref('');
const isLoading = ref(false);
const deviceInfo = ref<{ model: string; androidVersion: string } | null>(null);
const connectionStatus = ref<'connected' | 'disconnected' | 'connecting'>('disconnected');
const autoReconnectAttempts = ref(0);
const maxAutoReconnectAttempts = 3;
const disconnectionMessage = ref('');
const wifiUrl = ref('');
const wifiDeviceList = shallowRef<DeviceMeta[]>([]);

const deviceList = computed(() => {
    return [...usbDeviceList.value, ...wifiDeviceList.value];
});

const deviceOptions = computed(() => {
    return deviceList.value;
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const displayName = (device: DeviceMeta | AdbDaemonWebUsbDevice) =>
    (device as AdbDaemonWebUsbDevice).name || device.serial;

/** USB/ADB 传输层疑似被占用（本页或其它客户端未释放）时可先 disconnect 再重连 */
const isTransportOccupiedError = (e: unknown): boolean => {
    const err = e as { name?: string; message?: string };
    const name = (err?.name ?? '').toLowerCase();
    const msg = (err?.message ?? String(e)).toLowerCase();
    if (name === 'networkerror' || name === 'securityerror') return true;
    if (msg.includes('failed to connect')) return true;
    if (msg.includes('claim')) return true;
    if (msg.includes('busy')) return true;
    if (msg.includes('access denied')) return true;
    if (msg.includes('could not open')) return true;
    return false;
};

const connectWithOccupancyRecovery = async (device: AdbDaemonWebUsbDevice) => {
    try {
        await client.connect(device);
    } catch (first: unknown) {
        if (!isTransportOccupiedError(first)) {
            throw first;
        }
        await client.disconnect();
        await sleep(450);
        await client.connect(device);
    }
};

const selectDevice = async (device: any) => {
    if (selected.value?.serial === device?.serial && connectionStatus.value === 'connected') {
        return;
    }

    connectionStatus.value = 'connecting';
    isLoading.value = true;
    errorMessage.value = '';
    errorDetails.value = '';
    deviceInfo.value = null;
    emit('update-connection-status', false);
    try {
        await connectWithOccupancyRecovery(device);
        selected.value = device;
        connectionStatus.value = 'connected';
        showDevices.value = false;
        emit('pair-device', device);
        emit('update-connection-status', true);
        deviceInfo.value = {
            model: device.name || 'Unknown',
            androidVersion: 'Unknown',
        };
        autoReconnectAttempts.value = 0;
    } catch (error: any) {
        handleConnectionError(error);
    } finally {
        isLoading.value = false;
    }
};

const handleConnectionError = (error: any) => {
    if (error.message.includes('Unknown command: 48545541')) {
        errorMessage.value = '设备连接失败：未知命令';
        errorDetails.value = '请确保设备支持 ADB 调试，并且已在开发者选项中启用 USB 调试。';
    } else if (
        error.name === 'DOMException' &&
        error.message.includes('The transfer was cancelled')
    ) {
        errorMessage.value = '设备连接失败：USB 传输被取消';
        errorDetails.value = '请重新插拔设备并重试。如果问题持续，请尝试重启设备。';
    } else if (error.message.includes('No authenticator can handle the request')) {
        errorMessage.value = '设备认证失败：无法处理认证请求';
        errorDetails.value =
            '请检查设备上的 ADB 授权设置。在设备上点击"允许 USB 调试"对话框，然后重试连接。';
    } else {
        errorMessage.value = `设备连接失败`;
        errorDetails.value +=
            '这通常是已经运行了其他 ADB 客户端导致的。通过运行 `adb kill-server` 命令来终止其他 ADB 进程，然后再重新连接当前设备。';
    }
    emit('update-connection-status', false);
    connectionStatus.value = 'disconnected';
};

const retryConnection = async () => {
    if (selected.value) {
        await selectDevice(selected.value);
    }
};

const autoReconnect = async () => {
    if (autoReconnectAttempts.value < maxAutoReconnectAttempts) {
        await retryConnection();
        autoReconnectAttempts.value++;
    } else {
        errorMessage.value = '自动重连失败';
        errorDetails.value = '请手动重试连接或检查设备状态。';
    }
};

const toggleDevices = () => {
    showDevices.value = !showDevices.value;
};

const removeDevice = async (serial: string) => {
    isLoading.value = true;
    if (selected.value?.serial === serial) {
        selected.value = undefined;
        await client.disconnect();
        deviceInfo.value = null;
        emit('update-connection-status', false);
        connectionStatus.value = 'disconnected';
    }
    usbDeviceList.value = usbDeviceList.value.filter((device) => device.serial !== serial);
    wifiDeviceList.value = wifiDeviceList.value.filter((device) => device.serial !== serial);
    emit('remove-device', serial);
    isLoading.value = false;
};

const updateUsbDeviceList = async () => {
    isLoading.value = true;
    try {
        usbDeviceList.value = await client.getUsbDeviceList();
    } catch (error: any) {
        errorMessage.value = '获取设备列表失败';
        errorDetails.value = `${error.message}。请检查设备连接并重试。`;
    } finally {
        isLoading.value = false;
    }
    return usbDeviceList.value;
};

onMounted(async () => {
    const supported = client.isSupportedWebUsb;
    if (!supported) {
        errorMessage.value = '浏览器不支持 WebUSB';
        errorDetails.value = '请使用支持 WebUSB 的现代浏览器，如 Chrome 或 Edge 的最新版本。';
        return;
    }

    await updateUsbDeviceList();
    watcher.value = await client.trackUsbDevices();
    watcher.value.onListChange(() => {
        void updateUsbDeviceList();
    });
});

onUnmounted(() => {
    watcher.value?.stop();
});

watch(deviceList, async (newList) => {
    if (selected.value) {
        const current = newList.find((device) => device.serial === selected.value?.serial);
        if (!current) {
            await client.disconnect();
            const disconnectedDeviceName = selected.value.name || selected.value.serial;
            selected.value = undefined;
            deviceInfo.value = null;
            errorMessage.value = '设备已断开连接';
            errorDetails.value = '选中的设备已从列表中移除。请检查设备连接状态。';
            disconnectionMessage.value = `设备 ${disconnectedDeviceName} 已断开连接。请检查设备连接状态。`;
            emit('update-connection-status', false);
            connectionStatus.value = 'disconnected';
            await autoReconnect();
        } else {
            disconnectionMessage.value = '';
        }
    }
});

const handleAddDevice = async () => {
    errorMessage.value = '';
    errorDetails.value = '';
    try {
        const newDevice = await client.addUsbDevice();
        if (!newDevice) {
            return;
        }
        await updateUsbDeviceList();
        const toConnect =
            usbDeviceList.value.find((d) => d.serial === newDevice.serial) ?? newDevice;
        await selectDevice(toConnect);
    } catch (error: any) {
        if (!errorMessage.value) {
            errorMessage.value = '添加设备失败';
            errorDetails.value = `${error.message}。请确保设备已正确连接并启用了 USB 调试。`;
        }
    }
};

const openMenu = () => {
    showDevices.value = true;
};

const connectWifiDevice = async () => {
    const url = wifiUrl.value.trim();
    if (!url) {
        return;
    }

    errorMessage.value = '';
    errorDetails.value = '';
    connectionStatus.value = 'connecting';
    isLoading.value = true;
    emit('update-connection-status', false);
    try {
        const meta: DeviceMeta = {
            serial: url,
            connect: () => connectWifiBridge(url),
            initialDelayedAckBytes: 0,
        };
        await client.connect(meta);
        if (!wifiDeviceList.value.some((device) => device.serial === url)) {
            wifiDeviceList.value = [...wifiDeviceList.value, meta];
        }
        selected.value = meta as unknown as AdbDaemonWebUsbDevice;
        connectionStatus.value = 'connected';
        showDevices.value = false;
        emit('pair-device', meta);
        emit('update-connection-status', true);
        deviceInfo.value = {
            model: client.deviceName || url,
            androidVersion: 'Unknown',
        };
    } catch {
        errorMessage.value = 'Wi-Fi 设备连接失败';
        errorDetails.value = '请确认桥接地址可以访问，并确认设备已开启 TCP 调试端口';
        emit('update-connection-status', false);
        connectionStatus.value = 'disconnected';
    } finally {
        isLoading.value = false;
    }
};

defineExpose({ handleAddDevice, openMenu });
</script>

<template>
    <div class="paired-devices">
        <v-menu
            v-model="showDevices"
            transition="slide-y-transition"
            :close-on-content-click="false"
            min-width="300"
            max-width="420"
            location="bottom"
        >
            <template #activator="{ props }">
                <button class="device-trigger" v-bind="props">
                    <v-icon size="16" class="trigger-icon" :icon="mdiCellphoneLink" />
                    <span class="trigger-label">
                        {{ selected ? (selected.name || selected.serial) : '选择设备' }}
                    </span>
                    <span
                        class="trigger-dot"
                        :class="connectionStatus === 'connected' ? 'trigger-dot--on' : 'trigger-dot--off'"
                    />
                    <v-icon size="14" class="trigger-chevron" :icon="mdiChevronDown" />
                </button>
            </template>
            <div class="device-dropdown">
                <div class="dd-header">
                    <span class="dd-title">设备</span>
                    <div class="dd-actions">
                        <button class="dd-icon-btn" title="配对设备" @click="handleAddDevice">
                            <v-icon size="18" :icon="mdiPlus" />
                        </button>
                        <DeviceGuide />
                    </div>
                </div>

                <div v-if="errorMessage" class="dd-section">
                    <v-alert type="error" variant="tonal" density="compact" class="text-body-2">
                        <strong>{{ errorMessage }}</strong>
                        <div class="text-caption mt-1">{{ errorDetails }}</div>
                        <div class="mt-2 d-flex ga-2">
                            <v-btn v-if="selected" size="x-small" variant="text" @click="retryConnection">重试</v-btn>
                        </div>
                    </v-alert>
                </div>

                <div v-if="disconnectionMessage" class="dd-section">
                    <v-alert type="warning" variant="tonal" density="compact" class="text-body-2">
                        {{ disconnectionMessage }}
                    </v-alert>
                </div>

                <div v-if="!deviceList.length" class="dd-section dd-empty">
                    <p class="text-body-2 text-medium-emphasis mb-3">暂无已配对设备</p>
                    <v-btn variant="outlined" size="small" block @click="handleAddDevice">
                        <v-icon start size="16" :icon="mdiCellphoneLink" />
                        添加 USB 设备
                    </v-btn>
                </div>

                <div v-else class="dd-list">
                    <div
                        v-for="device in deviceOptions"
                        :key="device.serial"
                        class="dd-item"
                        @click="selectDevice(device)"
                    >
                        <div class="dd-item-icon">
                            <v-icon size="20" color="secondary" :icon="mdiCellphone" />
                        </div>
                        <div class="dd-item-info">
                            <span class="dd-item-name">{{ displayName(device) }}</span>
                            <span class="dd-item-serial">{{ device.serial }}</span>
                        </div>
                        <v-icon
                            v-if="selected?.serial === device.serial"
                            size="16"
                            color="success"
                            class="mr-1"
                         :icon="mdiCheckCircle" />
                        <button
                            class="dd-icon-btn"
                            title="移除设备"
                            @click.stop="removeDevice(device.serial)"
                        >
                            <v-icon size="16" :icon="mdiClose" />
                        </button>
                    </div>
                </div>

                <div class="dd-section dd-wifi">
                    <input
                        v-model="wifiUrl"
                        class="dd-input"
                        placeholder="桥接地址，如 ws://127.0.0.1:8888"
                        @keyup.enter="connectWifiDevice"
                    />
                    <button
                        class="dd-wifi-btn"
                        :disabled="!wifiUrl.trim() || isLoading"
                        @click="connectWifiDevice"
                    >
                        <v-icon size="16" :icon="mdiWifi" />
                        通过 Wi-Fi 连接
                    </button>
                    <p class="dd-hint">需要先在设备上开启 TCP 调试端口，并让桥接程序转发到该端口</p>
                </div>

                <div class="dd-footer">
                    <button class="dd-close-btn" @click="toggleDevices">关闭</button>
                </div>
            </div>
        </v-menu>
    </div>
</template>

<style scoped>
.paired-devices {
    display: inline-block;
}

.device-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgb(var(--v-theme-surface));
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.8);
    transition: border-color 0.15s, background 0.15s;
    outline: none;
    white-space: nowrap;
    max-width: 280px;
}

.device-trigger:hover {
    border-color: var(--border-hover);
    background: rgba(24, 24, 27, 0.02);
}

.trigger-icon {
    flex-shrink: 0;
    opacity: 0.5;
}

.trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.trigger-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.trigger-dot--on {
    background: #22c55e;
}

.trigger-dot--off {
    background: rgba(24, 24, 27, 0.2);
}

.trigger-chevron {
    opacity: 0.4;
    flex-shrink: 0;
}

.device-dropdown {
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    min-width: 300px;
    margin-top: 4px;
}

.dd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
}

.dd-title {
    font-size: 13px;
    font-weight: 600;
    color: rgba(24, 24, 27, 0.55);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.dd-actions {
    display: flex;
    gap: 4px;
    align-items: center;
}

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

.dd-section {
    padding: 0 14px 10px;
}

.dd-empty {
    padding: 16px 14px;
    text-align: center;
}

.dd-list {
    padding: 0 6px 4px;
}

.dd-wifi {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.dd-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    font-size: 13px;
    color: rgba(24, 24, 27, 0.85);
    outline: none;
}

.dd-input:focus {
    border-color: var(--border-hover);
}

.dd-wifi-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.7);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
}

.dd-wifi-btn:hover:not(:disabled) {
    background: rgba(24, 24, 27, 0.03);
    border-color: var(--border-hover);
}

.dd-wifi-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.dd-hint {
    font-size: 11px;
    line-height: 1.5;
    color: rgba(24, 24, 27, 0.45);
}

.dd-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
}

.dd-item:hover {
    background: rgba(24, 24, 27, 0.04);
}

.dd-item-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(24, 24, 27, 0.04);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.dd-item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.dd-item-name {
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.dd-item-serial {
    font-size: 11px;
    color: rgba(24, 24, 27, 0.4);
}

.dd-footer {
    padding: 8px 14px 12px;
    border-top: 1px solid var(--border);
}

.dd-close-btn {
    width: 100%;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    font-size: 13px;
    font-weight: 500;
    color: rgba(24, 24, 27, 0.6);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
}

.dd-close-btn:hover {
    background: rgba(24, 24, 27, 0.03);
    border-color: var(--border-hover);
}
</style>
