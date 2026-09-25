import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { ReadableStream } from '@yume-chan/stream-extra';
import { connectWifiBridge } from '../src/components/Scrcpy/wifi-connection.ts';

let key;

const credentialStore = {
    async generateKey() {
        const pair = await crypto.subtle.generateKey(
            { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
            true,
            ['sign', 'verify'],
        );
        key = { buffer: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)) };
        return key;
    },
    *iterateKeys() {
        if (key) yield key;
    },
};

await credentialStore.generateKey();

const connection = await connectWifiBridge(process.argv[2] ?? 'ws://127.0.0.1:8899');
console.log('websocket connected');

const transport = await AdbDaemonTransport.authenticate({
    serial: 'mock',
    connection,
    credentialStore,
    initialDelayedAckBytes: 0,
});
console.log('authenticated, banner =', transport.banner);

const adb = new Adb(transport);
const socket = await adb.createSocket('shell:echo hello');
const reader = socket.readable.getReader();
const decoder = new TextDecoder();
let text = '';
while (text.length === 0) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
}
console.log('shell output =', JSON.stringify(text));
console.log('banner serial =', transport.banner.serial, 'model =', transport.banner.model);
console.log('getProp =', await adb.getProp('ro.product.model'));
await adb.close();
console.log('OK');
