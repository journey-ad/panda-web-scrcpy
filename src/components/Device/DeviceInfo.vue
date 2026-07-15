<script setup lang="ts">
import { mdiApps, mdiBug, mdiCellphoneScreenshot, mdiCog, mdiInformation, mdiRefresh, mdiWeb, mdiWifi } from '@mdi/js'

import { ref, computed, onMounted } from 'vue';
import DeviceBasicInfo from './DeviceBasicInfo.vue';
import BatteryInfo from './BatteryInfo.vue';
import StorageInfo from './StorageInfo.vue';
import client from '../Scrcpy/adb-client';
import { Adb } from '@yume-chan/adb';

const device = computed(() => client.device || undefined);
const isLoading = ref(true);

const deviceInfo = ref({
    deviceModel: '',
    manufacturer: '',
    androidVersion: '',
    sdkVersionCode: '',
    resolution: '',
    screenDensity: '',
    ipAddress: '',
    totalMemory: '',
    usedMemory: '',
    totalStorage: '',
    usedStorage: '',
    serialNumber: '',
    cpuInfo: '',
    cpuMin: '',
    cpuMax: '',
    cpuCur: '',
    brand: '',
    product: '',
    board: '',
    display: '',
    id: '',
    fingerPrint: '',
    host: '',
    hardware: '',
    device: '',
    user: '',
    radioVersion: '',
    tags: '',
    type: '',
    basebandVer: '',
    cpuAbi: '',
    abis: '',
    batteryPercentage: 0,
    voltage: 0,
    temperature: 0,
    batteryHealth: 0,
    batteryChargeCounter: 0,
    batteryCurrent: 0,
    oemLockedState: '',
    bootloader: '',
    abPartition: '',
    uptime: '',
    storageType: '',
    kernelVersion: '',
    rootState: 'none',
});

async function executeShellCommand(device: Adb, command: string): Promise<string> {
    const subprocess = await device.subprocess.shellProtocol!.spawn(command);
    const reader = subprocess.stdout.getReader();
    let result = '';
    let done = false;

    try {
        while (!done) {
            const { value, done: isDone } = await reader.read();
            done = isDone;
            if (value) {
                result += new TextDecoder().decode(value);
            }
        }
    } finally {
        reader.releaseLock();
    }

    await subprocess.exited;
    return result.trim();
}

async function getDeviceInfo() {
    if (!device.value) return;

    const adbDevice = device.value;

    deviceInfo.value = {
        deviceModel: await adbDevice.getProp('ro.product.model'),
        manufacturer: await adbDevice.getProp('ro.product.manufacturer'),
        androidVersion: await adbDevice.getProp('ro.build.version.release'),
        sdkVersionCode: await adbDevice.getProp('ro.build.version.sdk'),
        resolution: await executeShellCommand(adbDevice, "wm size | awk '{print $3}'"),
        screenDensity: await adbDevice.getProp('ro.sf.lcd_density'),
        ipAddress: await executeShellCommand(
            adbDevice,
            "ip addr show wlan0 | grep 'inet ' | cut -d' ' -f6 | cut -d/ -f1"
        ),
        totalMemory: `${await executeShellCommand(
            adbDevice,
            "free -m | awk '/Mem:/ {print $2}'"
        )} MB`,
        usedMemory: await executeShellCommand(
            adbDevice,
            "free -m | awk '/Mem:/ {print $3}'"
        ),
        totalStorage: await executeShellCommand(
            adbDevice,
            "df -h /data | awk '/\\/data/ {print $2}'"
        ),
        usedStorage: await executeShellCommand(
            adbDevice,
            "df -h /data | awk '/\\/data/ {print $3}'"
        ),
        serialNumber: await adbDevice.getProp('ro.serialno'),
        cpuInfo: await adbDevice.getProp('ro.hardware'),
        cpuMin: await executeShellCommand(
            adbDevice,
            'cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq'
        ),
        cpuMax: await executeShellCommand(
            adbDevice,
            'cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq'
        ),
        cpuCur: await executeShellCommand(
            adbDevice,
            'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'
        ),
        brand: await adbDevice.getProp('ro.product.brand'),
        product: await adbDevice.getProp('ro.product.name'),
        board: await adbDevice.getProp('ro.product.board'),
        display: await adbDevice.getProp('ro.build.display.id'),
        id: await adbDevice.getProp('ro.build.id'),
        fingerPrint: await adbDevice.getProp('ro.build.fingerprint'),
        host: await adbDevice.getProp('ro.build.host'),
        hardware: await adbDevice.getProp('ro.hardware'),
        device: await adbDevice.getProp('ro.product.device'),
        user: await adbDevice.getProp('ro.build.user'),
        radioVersion: await adbDevice.getProp('gsm.version.baseband'),
        tags: await adbDevice.getProp('ro.build.tags'),
        type: await adbDevice.getProp('ro.build.type'),
        basebandVer: await adbDevice.getProp('gsm.version.baseband'),
        cpuAbi: await adbDevice.getProp('ro.product.cpu.abi'),
        abis: await adbDevice.getProp('ro.product.cpu.abilist'),
        batteryPercentage: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep level | awk \'{print $2}\''), 10),
        voltage: parseFloat((await executeShellCommand(
            adbDevice, 
            'dumpsys battery | grep "  voltage" | awk \'{print $2}\''
        )) || '0') / 1000,
        temperature: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep temperature | awk \'{print $2}\''), 10) / 10,
        batteryHealth: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep mSavedBatteryAsoc | awk \'{print $2}\''), 10),
        batteryChargeCounter: parseFloat(await executeShellCommand(adbDevice, 'dumpsys battery | grep "Charge counter" | awk \'{print $3}\'') || '0') / 1000,
        batteryCurrent: parseInt(await executeShellCommand(adbDevice, 'dumpsys battery | grep "current now" | awk \'{print $3}\''), 10),
        oemLockedState: await executeShellCommand(
            adbDevice,
            'getprop ro.boot.flash.locked'
        ),
        bootloader: await executeShellCommand(
            adbDevice,
            'getprop ro.boot.verifiedbootstate'
        ),
        abPartition: await executeShellCommand(
            adbDevice,
            'getprop ro.boot.slot_suffix'
        ),
        uptime: await executeShellCommand(
            adbDevice,
            'cat /proc/uptime | cut -d. -f1'
        ),
        storageType: await executeShellCommand(
            adbDevice,
            'if getprop ro.boot.bootdevice | grep -qi ufs; then echo UFS; else echo eMMC; fi'
        ),
        kernelVersion: await executeShellCommand(
            adbDevice,
            'uname -r'
        ),
        rootState: await executeShellCommand(
            adbDevice,
            'ls /system/bin/su > /dev/null 2>&1 && echo rooted || echo none'
        ),
    };
}

const openSettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.SETTINGS');
};

const openDeveloperOptions = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS');
};

const openBrowser = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.intent.action.VIEW -d "http://www.google.com"');
};

const openWifiSettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.WIFI_SETTINGS');
};

const openDisplaySettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.DISPLAY_SETTINGS');
};

const openAppSettings = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.APPLICATION_SETTINGS');
};

const openAboutPhone = async () => {
    if (!device.value) return;
    await executeShellCommand(device.value, 'am start -a android.settings.DEVICE_INFO_SETTINGS');
};

const refreshDeviceInfo = async () => {
    isLoading.value = true;
    try {
        await getDeviceInfo();
    } finally {
        isLoading.value = false;
    }
};

onMounted(async () => {
    if (client.isConnected) {
        await getDeviceInfo();
        isLoading.value = false;
    } else {
        console.error('Device not connected');
        isLoading.value = false;
    }
});
</script>

<template>
    <div class="device-info">
        <div v-if="isLoading" class="info-grid">
            <v-skeleton-loader type="article, actions" class="skeleton-card" />
            <div class="info-side">
                <v-skeleton-loader type="card" class="skeleton-card" />
                <v-skeleton-loader type="card" class="skeleton-card" />
            </div>
        </div>
        <div v-else class="info-grid">
            <div class="basic-info-container">
                <DeviceBasicInfo :deviceInfo="deviceInfo" />
                <v-btn
                    class="refresh-btn"
                    :icon="mdiRefresh"
                    variant="text"
                    size="small"
                    :loading="isLoading"
                    @click="refreshDeviceInfo"
                    title="刷新设备信息"
                />
            </div>
            <div class="info-side">
                <BatteryInfo 
                    :batteryPercentage="deviceInfo.batteryPercentage" 
                    :voltage="deviceInfo.voltage" 
                    :temperature="deviceInfo.temperature" 
                    :batteryHealth="deviceInfo.batteryHealth"
                    :batteryChargeCounter="deviceInfo.batteryChargeCounter"
                    :batteryCurrent="deviceInfo.batteryCurrent"
                />
                <StorageInfo :deviceInfo="deviceInfo" />
            </div>
            <div class="device-controls">
                <v-btn-group variant="outlined" class="control-group">
                    <v-btn size="small" :prepend-icon="mdiCog" @click="openSettings" title="打开系统设置">设置</v-btn>
                    <v-btn size="small" :prepend-icon="mdiBug" @click="openDeveloperOptions" title="打开开发者选项">开发者</v-btn>
                    <v-btn size="small" :prepend-icon="mdiWeb" @click="openBrowser" title="打开浏览器">浏览器</v-btn>
                    <v-btn size="small" :prepend-icon="mdiWifi" @click="openWifiSettings" title="打开WiFi设置">WiFi</v-btn>
                </v-btn-group>
                <v-btn-group variant="outlined" class="control-group">
                    <v-btn size="small" :prepend-icon="mdiCellphoneScreenshot" @click="openDisplaySettings" title="打开显示设置">显示</v-btn>
                    <v-btn size="small" :prepend-icon="mdiApps" @click="openAppSettings" title="打开应用设置">应用</v-btn>
                    <v-btn size="small" :prepend-icon="mdiInformation" @click="openAboutPhone" title="关于手机">关于</v-btn>
                </v-btn-group>
            </div>
        </div>
    </div>
</template>

<style scoped>
.device-info {
    box-sizing: border-box;
    height: 100%;
    padding: 12px;
    overflow-y: auto;
}

.basic-info-container {
    position: relative;
}

.refresh-btn {
    position: absolute;
    top: 10px;
    right: 12px;
    z-index: 1;
}

.info-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
}

.info-main {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.device-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
}

.control-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 8px;
    width: 100%;
}

.control-group :deep(.v-btn) {
    flex: 1;
    text-transform: none;
    min-width: 0;
    padding: 0 8px;
}

.info-side {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}

.info-side :deep(.v-card) {
    height: 100%;
    min-height: 160px;
}

@media (max-width: 768px) {
    .control-group {
        grid-template-columns: 1fr 1fr;
    }

    .info-side {
        grid-template-columns: 1fr;
    }
}

/* 适配暗色主题 */
:deep(.v-theme--dark) .device-controls {
    background-color: var(--v-surface-variant-dark);
}

.skeleton-card {
    background: rgb(var(--v-theme-surface));
    border: 1px solid var(--border);
    height: 100%;
    min-height: 120px;
}

/* 适配暗色主题 */
:deep(.v-theme--dark) .skeleton-card {
    background-color: var(--v-surface-variant-dark);
}
</style>
