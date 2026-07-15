import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { Adb, AdbDaemonTransport, type AdbDaemonConnection } from '@yume-chan/adb';

export interface DeviceMeta {
    serial: string;
    connect: () => Promise<AdbDaemonConnection>;
}

export class AdbClient {
    device: Adb | undefined;
    serial: string | undefined;
    name: string | undefined;
    credentialStore: AdbWebCredentialStore;

    constructor() {
        this.credentialStore = new AdbWebCredentialStore('high-qa');
    }

    get isSupportedWebUsb() {
        return !!AdbDaemonWebUsbDeviceManager.BROWSER;
    }

    get isConnected() {
        return !!this.device;
    }

    get deviceName() {
        return this.name;
    }

    get deviceSerial() {
        return this.serial;
    }

    async connect(deviceMeta: DeviceMeta) {
        if (this.device) {
            await this.disconnect();
        }
        let readable: AdbDaemonConnection['readable'];
        let writable: AdbDaemonConnection['writable'];
        try {
            const streams = await deviceMeta.connect();
            readable = streams.readable;
            writable = streams.writable;
        } catch (e: any) {
            if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'NetworkError') {
                throw new Error(
                    'Failed to connect to device. Please check if the device is connected and try again.'
                );
            }
            throw e instanceof Error ? e : new Error(String(e));
        }

        this.device = new Adb(
            await AdbDaemonTransport.authenticate({
                serial: deviceMeta.serial,
                connection: { readable, writable },
                credentialStore: this.credentialStore,
            })
        );
        this.serial = await this.device.getProp('ro.serialno');
        this.name = await this.device.getProp('ro.product.model');

        return this.device;
    }

    async disconnect() {
        if (!this.device) {
            return;
        }
        await this.device.close();
        this.device = undefined;
        this.serial = undefined;
        this.name = undefined;
    }

    /**
     * 结束设备上可能残留的 scrcpy 服务端，避免端口/进程占用导致无法再次投屏。
     * 依赖已建立的 Adb 会话；失败时静默忽略。
     */
    async killScrcpyServerOnDevice(): Promise<void> {
        const adb = this.device;
        if (!adb?.subprocess?.noneProtocol) {
            return;
        }
        try {
            await adb.subprocess.noneProtocol.spawnWaitText(
                "sh -c 'pkill -9 -f com.genymobile.scrcpy 2>/dev/null; pkill -9 -f scrcpy 2>/dev/null; true'",
            );
        } catch {
            // 无 pkill、权限或进程不存在时忽略
        }
    }

    async addUsbDevice() {
        return await AdbDaemonWebUsbDeviceManager.BROWSER!.requestDevice();
    }

    async getUsbDeviceList() {
        return await AdbDaemonWebUsbDeviceManager.BROWSER!.getDevices();
    }

    async trackUsbDevices() {
        return await AdbDaemonWebUsbDeviceManager.BROWSER!.trackDevices();
    }
}

const client = new AdbClient();
export default client;
