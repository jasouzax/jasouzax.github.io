/* The agent's signed upgrade must be accepted by the Worker's own verifier (src/node/security.ts), and by nothing else. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify_origin } from '../../src/node/security.ts';
import { sign_upgrade } from '../src/sign.ts';

const secret = 'k'.repeat(40);
const url = 'https://jasouza.com/api/server/agent';
const request = (headers: Record<string, string>, target = url) => new Request(target, { headers });

test('the Worker verifies what the agent signs', async () => {
    assert.equal(await verify_origin(request(sign_upgrade(secret, url)), secret, new Map()), true);
});

test('wrong secret, other path, stale time and replayed nonce are refused', async () => {
    assert.equal(await verify_origin(request(sign_upgrade('x'.repeat(40), url)), secret, new Map()), false);
    assert.equal(await verify_origin(request(sign_upgrade(secret, url), 'https://jasouza.com/api/server/other'), secret, new Map()), false);
    assert.equal(await verify_origin(request(sign_upgrade(secret, url, Date.now() - 120_000)), secret, new Map()), false);
    const seen = new Map<string, number>();
    const headers = sign_upgrade(secret, url);
    assert.equal(await verify_origin(request(headers), secret, seen), true);
    assert.equal(await verify_origin(request(headers), secret, seen), false);
});

test('a ws:// style url signs the same path as the https request the Worker sees', async () => {
    assert.equal(await verify_origin(request(sign_upgrade(secret, 'wss://jasouza.com/api/server/agent')), secret, new Map()), true);
});
