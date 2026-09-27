import { AdbPacket, AdbPacketSerializeStream, type AdbDaemonConnection } from '@yume-chan/adb';
import {
    Consumable,
    PushReadableStream,
    StructDeserializeStream,
    WrapWritableStream,
} from '@yume-chan/stream-extra';

/**
 * 连接 WebSocket 桥接地址，桥的另一端通向设备上的 adbd 端口
 * 浏览器无法建立 TCP 连接，裸字节流由桥转发
 */
export async function connectWifiBridge(url: string): Promise<AdbDaemonConnection> {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('桥接地址无法连接')), { once: true });
    });

    const readable = new PushReadableStream<Uint8Array>((controller) => {
        socket.addEventListener('message', (event) => {
            void controller.enqueue(new Uint8Array(event.data as ArrayBuffer));
        });
        socket.addEventListener('close', () => controller.close(), { once: true });
        socket.addEventListener(
            'error',
            () => controller.error(new Error('桥接连接已中断')),
            { once: true },
        );
    }).pipeThrough(new StructDeserializeStream(AdbPacket));

    const writable = new WrapWritableStream(
        new Consumable.WritableStream<Uint8Array>({
            write(chunk) {
                socket.send(chunk);
            },
        }),
    ).bePipedThroughFrom(new AdbPacketSerializeStream());

    return { readable, writable };
}
