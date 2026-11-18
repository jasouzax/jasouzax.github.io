import { app } from 'electron';
import { config as load_env } from 'dotenv';
import * as path from 'path';
import { parse_config } from './config';
import { Web } from './web';

// The agent has to outlive every window: the page comes and goes while scripts run
Web.keep_alive = true;

async function main(): Promise<void> {
    await app.whenReady();
    const root = app.getAppPath();
    load_env({ path: path.join(root, '.env'), quiet: true });
    const config = parse_config(process.env, root);
    console.log(`[server] agent for ${config.origin}, file system root ${config.fs_root}`);
}

main().catch((error) => {
    console.error('[server] failed to start:', error instanceof Error ? error.message : error);
    app.exit(1);
});
