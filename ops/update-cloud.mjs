// Code/content update of existing hosting. Resource bindings and secrets are inherited.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish_pages } from '../src/step/cloud_publish.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);
const target = process.argv[2];
if (!['production', 'staging'].includes(target)) throw Error('Usage: node --env-file=.env ops/update-cloud.mjs production|staging');
const branch = target === 'production' ? 'master' : 'staging';
const worker = target === 'production' ? 'jazu_router' : 'jazu_staging_router';
const project = target === 'production' ? 'jazu' : 'jazu-staging';
const bucket = target === 'production' ? 'jazu-assets' : 'jazu-staging-assets';
const domain = target === 'production' ? 'jasouza.com' : 'staging.jasouza.com';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const remote = execFileSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { encoding: 'utf8' }).trim().split(/\s/)[0];
if (revision !== remote) throw Error(`HEAD must match GitHub ${branch}; fetch and check out that commit first`);
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() && !process.argv.includes('--allow-tracked-edits')) throw Error('Commit tracked edits first (or explicitly pass --allow-tracked-edits for deployment tooling only)');
const account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.TF_VAR_account_id;
if (!account || !process.env.CLOUDFLARE_API_TOKEN) throw Error('Load Cloudflare credentials from your private .env');
const directory = resolve('.cache/live-update', `${target}-${revision.slice(0, 12)}`);
mkdirSync(directory, { recursive: true });
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
async function api(path, init = {}) {
    const response = await fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
    const value = await response.json();
    if (!response.ok || !value.success) throw Error(`Cloudflare ${path}: ${JSON.stringify(value.errors)}`);
    return value.result;
}
const settings = await api(`/workers/scripts/${worker}/settings`);
const previousDeployments = await api(`/workers/scripts/${worker}/deployments`);
const pages = await api(`/pages/projects/${project}`);
if (pages.production_branch !== branch) throw Error('Unexpected Pages production branch');
const domainBinding = settings.bindings.find(binding => binding.name === 'DOMAIN');
if (domainBinding?.text !== domain) throw Error('Unexpected Worker DOMAIN binding');
writeFileSync(resolve(directory, 'previous-settings.json'), JSON.stringify(settings, null, 2));
writeFileSync(resolve(directory, 'previous-deployments.json'), JSON.stringify(previousDeployments, null, 2));
writeFileSync(resolve(directory, 'previous-pages.json'), JSON.stringify(pages, null, 2));
const previousCode = await fetch(`${base}/workers/scripts/${worker}`, { headers });
if (!previousCode.ok) throw Error('Cannot back up previous Worker code');
writeFileSync(resolve(directory, 'previous-worker.multipart'), new Uint8Array(await previousCode.arrayBuffer()));
writeFileSync(resolve(directory, 'previous-worker-headers.json'), JSON.stringify({ content_type: previousCode.headers.get('content-type') }, null, 2));
const output = resolve('dist', `update-${target}`);
execFileSync(process.execPath, ['src/main.ts', 'build', '--out', output, '--base_url', `https://${domain}`], { stdio: 'inherit' });
const bundle = resolve(directory, 'worker.js');
await build({ entryPoints: ['cloud/router/index.ts'], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
const metadata = { main_module: 'worker.js', compatibility_date: settings.compatibility_date,
    compatibility_flags: settings.compatibility_flags || [],
    bindings: settings.bindings.map(binding => ({ name: binding.name, type: 'inherit' })),
};
for (const key of ['limits', 'observability', 'placement', 'logpush', 'tail_consumers']) if (settings[key] !== undefined) metadata[key] = settings[key];
const form = new FormData();
form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.set('worker.js', new Blob([readFileSync(bundle)], { type: 'application/javascript+module' }), 'worker.js');
const uploaded = await api(`/workers/scripts/${worker}?bindings_inherit=strict`, { method: 'PUT', body: form });
const after = await api(`/workers/scripts/${worker}/settings`);
const deployments = await api(`/workers/scripts/${worker}/deployments`);
const signature = bindings => bindings.map(binding => `${binding.name}:${binding.type}:${binding.namespace_id || binding.id || binding.bucket_name || ''}`).sort();
if (JSON.stringify(signature(after.bindings)) !== JSON.stringify(signature(settings.bindings))) throw Error('Worker binding identity changed; inspect saved settings before proceeding');
console.log(`Updated ${worker}; retained ${settings.bindings.length} existing bindings`);
const published = publish_pages(root, output, project, { branch, commit: revision, message: `Update ${target} to ${revision.slice(0, 12)}`, assets_bucket: bucket, state_file: resolve('.cache/live-update', `${target}-publish.json`), force: true });
const current = await api(`/pages/projects/${project}`);
if (current.canonical_deployment?.deployment_trigger?.metadata?.commit_hash !== revision) throw Error('Pages deployment revision did not match');
writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ target, revision, worker_upload: uploaded.id, worker_deployments: deployments, deployment: current.canonical_deployment.id, url: `https://${domain}`, published }, null, 2));
console.log(`Verified ${domain}: Pages ${current.canonical_deployment.id} at ${revision}`);
