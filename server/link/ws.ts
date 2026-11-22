import WebSocket from 'ws';
import type { Open_Socket, Socket_Like } from './hub.ts';
import { max_frame_bytes } from '../../shared/protocol/wire.ts';

// The production socket: the `ws` package behind the small Socket_Like contract. Not imported by tests
export const open_ws: Open_Socket = (url, headers) => {
    const socket = new WebSocket(url.replace(/^http/, 'ws'), { headers, maxPayload: max_frame_bytes * 2, handshakeTimeout: 15_000 });
    const adapter: Socket_Like = {
        send: (data) => socket.send(data),
        close: (code) => socket.close(code),
        terminate: () => socket.terminate(),
        get buffered() {
            return socket.bufferedAmount;
        },
        on: ((event: string, handler: (...args: any[]) => void) => {
            if (event === 'message') socket.on('message', (data, is_binary) => handler(is_binary ? new Uint8Array(data as Buffer) : (data as Buffer).toString('utf8'), is_binary));
            else if (event === 'rejected') {
                // With a listener ws no longer aborts the handshake by itself
                socket.on('unexpected-response', (request, response) => {
                    handler(response.statusCode ?? 0);
                    request.destroy();
                });
            }
            else socket.on(event, handler);
        }) as Socket_Like['on'],
    };
    return adapter;
};
