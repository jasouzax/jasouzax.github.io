/* parse_config: defaults, https enforcement, secret length, root normalisation. Runs without Electron. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse_config } from '../src/config.ts';

const secret = 's'.repeat(32);

test('defaults point at the production site and the whole disk', () => {
    const config = parse_config({ SERVER_AGENT_SECRET: secret }, '/app');
    assert.equal(config.origin, 'https://jasouza.com');
    assert.equal(config.fs_root, '/');
    assert.equal(config.fastfetch_structure, '');
});

test('plain http is only for loopback; paths in the origin are refused', () => {
    assert.equal(parse_config({ JAZU_ORIGIN: 'http://127.0.0.1:8787/', SERVER_AGENT_SECRET: secret }, '/app').origin, 'http://127.0.0.1:8787');
    assert.throws(() => parse_config({ JAZU_ORIGIN: 'http://jasouza.com', SERVER_AGENT_SECRET: secret }, '/app'), /https/);
    assert.throws(() => parse_config({ JAZU_ORIGIN: 'https://jasouza.com/x', SERVER_AGENT_SECRET: secret }, '/app'), /origin only/);
    assert.throws(() => parse_config({ JAZU_ORIGIN: 'nope', SERVER_AGENT_SECRET: secret }, '/app'), /not a URL/);
});

test('the secret must be long, the root absolute and normalised, the structure a plain list', () => {
    assert.throws(() => parse_config({ SERVER_AGENT_SECRET: 'short' }, '/app'), /32 characters/);
    assert.throws(() => parse_config({ SERVER_AGENT_SECRET: secret, SERVER_ROOT: 'relative' }, '/app'), /absolute/);
    assert.equal(parse_config({ SERVER_AGENT_SECRET: secret, SERVER_ROOT: '/home/pi//data/../files/' }, '/app').fs_root, '/home/pi/files');
    assert.equal(parse_config({ SERVER_AGENT_SECRET: secret, FASTFETCH_STRUCTURE: 'OS:Kernel:CPU' }, '/app').fastfetch_structure, 'OS:Kernel:CPU');
    assert.throws(() => parse_config({ SERVER_AGENT_SECRET: secret, FASTFETCH_STRUCTURE: 'OS; rm -rf /' }, '/app'), /colon separated/);
});
