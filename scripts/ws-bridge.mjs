import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const listenPort = Number(process.argv[2] ?? 8899);
const [targetHost, targetPort] = (process.argv[3] ?? '127.0.0.1:5555').split(':');

function encodeFrame(data) {
    const length = data.length;
    let header;
    if (length < 126) {
        header = Buffer.from([0x82, length]);
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x82;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }
    return Buffer.concat([header, data]);
}

function createDecoder(onFrame, onClose) {
    let buffer = Buffer.alloc(0);
    return (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
            const opcode = buffer[0] & 0x0f;
            const masked = (buffer[1] & 0x80) !== 0;
            let length = buffer[1] & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (buffer.length < 4) return;
                length = buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (buffer.length < 10) return;
                length = Number(buffer.readBigUInt64BE(2));
                offset = 10;
            }
            let mask;
            if (masked) {
                if (buffer.length < offset + 4) return;
                mask = buffer.subarray(offset, offset + 4);
                offset += 4;
            }
            if (buffer.length < offset + length) return;
            const payload = Buffer.from(buffer.subarray(offset, offset + length));
            buffer = buffer.subarray(offset + length);
            if (masked) {
                for (let i = 0; i < payload.length; i += 1) {
                    payload[i] ^= mask[i % 4];
                }
            }
            if (opcode === 0x8) {
                onClose();
                return;
            }
            if (opcode === 0x2) {
                onFrame(payload);
            }
        }
    };
}

const server = createServer();
server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1')
        .update(request.headers['sec-websocket-key'] + GUID)
        .digest('base64');
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const upstream = createConnection({ host: targetHost, port: Number(targetPort) });
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => socket.destroy());
    upstream.on('data', (data) => socket.write(encodeFrame(data)));

    const decode = createDecoder(
        (data) => upstream.write(data),
        () => upstream.end(),
    );
    socket.on('data', decode);
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
});

server.listen(listenPort, '127.0.0.1', () => {
    console.log(`bridge ws://127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`);
});
