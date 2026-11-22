/*
 * Settings of the agent, read from the environment (server/.env). No Electron here, so tests can call parse_config directly.
 *
 * Entities
 *   Config        what the rest of the agent needs: where the Worker is, the shared secret, the folder everything is confined to
 *   parse_config  validates an environment object; throws one readable Error per problem
 *
 * Limits
 *   The secret is never logged. A plain http origin is accepted only for loopback (local wrangler dev).
 */
import * as path from 'path';

export interface Config {
    // The app folder: holds .env, assets/ and user_data/
    root: string;
    // The Worker, without a trailing slash
    origin: string;
    secret: string;
    // Absolute, normalised folder the file system channel is confined to
    fs_root: string;
    // Modules of the public fastfetch snapshot, '' for the built-in default
    fastfetch_structure: string;
}

const loopback_hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function parse_config(env: Record<string, string | undefined>, root: string): Config {
    const raw_origin = (env.JAZU_ORIGIN || 'https://jasouza.com').trim().replace(/\/+$/, '');
    let url: URL;
    try {
        url = new URL(raw_origin);
    } catch {
        throw new Error(`JAZU_ORIGIN is not a URL: ${raw_origin}`);
    }
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('JAZU_ORIGIN must be an origin only (no path)');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback_hosts.has(url.hostname))) {
        throw new Error('JAZU_ORIGIN must be https (http is only allowed for 127.0.0.1 / localhost)');
    }
    const secret = (env.SERVER_AGENT_SECRET || '').trim();
    if (secret.length < 32) throw new Error('SERVER_AGENT_SECRET must be at least 32 characters (openssl rand -hex 32), the same as the Worker secret');
    const fs_root = path.posix.normalize(env.SERVER_ROOT?.trim() || '/');
    if (!path.posix.isAbsolute(fs_root)) throw new Error('SERVER_ROOT must be an absolute path');
    const structure = (env.FASTFETCH_STRUCTURE || '').trim();
    if (structure && !/^[A-Za-z0-9:_-]+$/.test(structure)) throw new Error('FASTFETCH_STRUCTURE is a colon separated list of module names');
    return { root, origin: url.origin, secret, fs_root: fs_root.length > 1 ? fs_root.replace(/\/+$/, '') : fs_root, fastfetch_structure: structure };
}
