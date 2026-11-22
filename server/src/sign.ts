import { createHash, createHmac, randomUUID } from 'crypto';
import { agent_client_id } from '../../shared/protocol/wire.ts';

// Headers that make the Worker accept the upgrade: the same HMAC as src/node/security.ts (sign_origin, "hash" mode, empty body).
// Fresh on every attempt: the Worker refuses a nonce it has seen and a timestamp more than a minute off
export function sign_upgrade(secret: string, url: string, now = Date.now()): Record<string, string> {
    const target = new URL(url);
    const timestamp = String(Math.floor(now / 1000));
    const nonce = randomUUID();
    const body_hash = createHash('sha256').update('').digest('hex');
    const payload = ['GET', target.pathname + target.search, timestamp, nonce, agent_client_id, body_hash].join('\n');
    return {
        'x-jazu-time': timestamp,
        'x-jazu-nonce': nonce,
        'x-jazu-client': agent_client_id,
        'x-jazu-signature': createHmac('sha256', secret).update(payload).digest('hex'),
    };
}
