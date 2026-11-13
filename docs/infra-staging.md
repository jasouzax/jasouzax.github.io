# Staging on the personal server

The implementation is project-independent: each `<project>` can declare multiple `<pipeline branch="...">` entries. The first is primary. Jazu declares `master` for `jasouza.com` and `staging` for `staging.jasouza.com`. Both use the same Pi deployment checkout; CI and runtime staging retain their existing reusable isolated workspaces, with no Git worktrees per branch.

This guide applies **after reviewing and merging `feature/listener-isolation` with `git merge --no-ff`**. These instructions provision a separate Pages project, Worker and R2 bucket. No production infrastructure needs replacement. New resources have not been provisioned by the feature branch itself.

## 1. Merge and push master on your laptop

```sh
git switch master
git merge --no-ff feature/listener-isolation
git push origin master
```

Do not publish the staging branch yet. Configure its hosting before enabling its first deployment. If staging already exists, stop the node before pushing this merge so it cannot start a staging deployment during setup.

## 2. Install the merged code on the Pi

```sh
ssh jason@192.168.1.22
sudo systemctl stop jazu-node
export PATH="$HOME/.local/bin:$PATH"
cd ~/jasouzax.github.io
git status --short
```

Resolve any tracked edits before continuing. Keep `.env`, `server.json`, ignored `build/` and `content/media/`, and `/home/jason/.local/state/jazu` in place. Then:

```sh
git switch master
git pull --ff-only origin master
npm ci --no-audit --no-fund
node --version
```

Use Node 22.18+ (the service already uses the Node under `~/.local/bin`). `server.json` should retain `site.project: "jazu"`, `site.dir: "/home/jason/jasouzax.github.io"` and `site.branch: "master"`. No second project/path entry is needed. The XML pipelines select and switch the checked-out branch; an old `site.checkout_branch: "master"` override does not pin a project with multiple pipelines to master.

## 3. Provision staging hosting with Terraform

Install Terraform 1.7+ on the machine that will own staging state (normally the Pi). After `npm ci`, run from the repository root:

```sh
npm run tf:staging -- plan
npm run tf:staging -- apply
```

The setup command bundles `src/node/worker.ts` into `.cache/staging-infra/worker.js`, initializes the standalone root at `terraform/staging/`, and runs Terraform. Review the plan and approve the apply. It provisions:

- Pages project `jazu-staging`, with production branch `staging`.
- R2 bucket `jazu-staging-assets`.
- The `staging.jasouza.com` Pages custom-domain association and a proxied DNS CNAME.
- Worker `jazu_staging_router`, its staging route and R2 binding, with workers.dev disabled.
- `DOMAIN`, the actual allocated Pages origin, public Git discovery and the personal origin bindings.
- `PROJECT_CLONE_ORIGINS`, generated privately from public XML project `repo` declarations, for provider-first cloning with Pi fallback.
- The existing `ORIGIN_HMAC_SECRET`, `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET` as Worker secrets.

No dashboard domain registration or separate Wrangler secret upload is needed. Terraform reads the allocated Pages hostname directly, including any Cloudflare-added suffix. TLS/domain activation can take time; the site receives its first static content when staging CI runs.

The command loads the existing private `.env`. `TF_VAR_*` inputs take precedence over aliases:

| Terraform input | Existing .env alias |
|---|---|
| `account_id` | `CLOUDFLARE_ACCOUNT_ID` |
| `zone_id` | `CLOUDFLARE_ZONE_ID` |
| `origin_hmac_secret` | `ORIGIN_HMAC_SECRET`, then `HMAC_SECRET` |
| `access_client_id` | `ACCESS_CLIENT_ID` |
| `access_client_secret` | `ACCESS_CLIENT_SECRET` |
| `personal_origin` | `PERSONAL_ORIGIN` (optional) |

`CLOUDFLARE_API_TOKEN` authenticates the provider. It needs account Pages/R2/Workers Scripts edit access and zone DNS/Workers Routes edit access. The account/zone ids and all three origin secrets are required; Terraform reports missing fields instead of generating mismatched credentials. The secrets must match the existing Pi and Access service token. R2 S3 access keys are unnecessary for this root: CI continues to upload objects with Wrangler and the existing API token.

Staging has its own local state at `terraform/staging/terraform.tfstate`; production's Terraform state is never loaded. Keep this state private and backed up on one provisioning machine; it contains Worker secrets. Secrets are passed through the child environment, not command arguments or generated var-files. State, local tfvars and saved plans are git-ignored. Commit the provider lock file. Optional resource overrides belong in `terraform/staging/terraform.tfvars` (see its example); update the XML publish targets too if changing project/bucket/branch names.

For details, local validation, existing-resource imports and state ownership, see [terraform/staging/README.md](../terraform/staging/README.md). If the earlier manual commands already created staging resources, import them before applying. The standalone root has no production imports and no production resource dependencies.

Terraform owns the staging Worker after setup. To publish routing code/binding/secret changes, run the same plan/apply commands again. `wrangler.staging.jsonc` remains a dry-run/reference configuration; avoid deploying over the Terraform-managed Worker with Wrangler. The XML pipeline still publishes static Pages/R2 output independently of infrastructure.

## 4. Start the listener

```sh
node --env-file=.env src/main.ts server sync
sudo systemctl start jazu-node
systemctl is-active jazu-node cloudflared
journalctl -u jazu-node -n 40 --no-pager
```

Keep the service's `Restart=on-failure` setting. The initial install needs this restart; later accepted engine runtime changes request a restart automatically after their job completes. A nonexistent upstream staging branch stays idle without a sync error.

## 5. Create or update staging from the merged master

On your laptop, for a new branch:

```sh
git switch -c staging master
git push -u origin staging
```

For an existing staging branch, merge the new master into it and resolve conflicts before pushing:

```sh
git switch staging
git merge --no-ff master
git push origin staging
```

This merge is required: an older engine worker without branch pipeline support is rejected before deployment. Keep both pipeline declarations in the same order on both branches. Later experimental commits can be pushed either to GitHub's staging branch or with your existing owner token to `https://jasouza.com/projects/jazu` using `git push personal staging`. No new Git credential is required; write-role collaborator tokens cannot deploy staging directly.

## 6. Verify and operate

After the next poll (normally within 60 seconds) and CI/build:

```sh
cd ~/jasouzax.github.io
export PATH="$HOME/.local/bin:$PATH"
node --env-file=.env src/main.ts server status --project jazu --branch staging
git branch --show-current
curl -I https://staging.jasouza.com
curl 'https://jasouza.com/api/v1/ci/jazu/runs?branch=staging'
```

The successful job lists `refs/heads/staging`; the checkout remains on `staging`. The pipeline builds canonical URLs for `https://staging.jasouza.com`, publishes to Pages project `jazu-staging` with branch `staging`, and uploads large assets to bucket `jazu-staging-assets`. It does not publish the primary clone mirror or deploy the production Pages project. The staging site is public; protect the hostname with Cloudflare Access if experiments must be private.

An update to master runs master's pipeline and switches the same checkout back to master. Polling an unchanged master does not switch branches or deploy again. Jobs for different branches are serialized and never supersede one another. CI failure leaves the approved checkout unchanged; dirty files and divergent target branches are refused, never force-reset.

To retry a failed branch job or explicitly select a branch:

```sh
node --env-file=.env src/main.ts server run --project jazu --branch staging
```

Logs remain under `/home/jason/.local/state/jazu/runs/`. Primary sync/approval/publication files keep their existing paths; staging state is under `/home/jason/.local/state/jazu/branches/staging/`. One CI workspace and one runtime workspace are reused. Clone requests on the public project URL continue to receive the approved primary branch. When the engine checkout is staging, automatic CD-only production mirror publications are deferred until master next updates (or an explicit master run).
