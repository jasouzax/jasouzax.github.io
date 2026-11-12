# Standalone staging infrastructure

This Terraform root creates staging Pages, R2, a Worker with its secret/resource bindings, a Pages custom domain, proxied DNS and a Worker route. Defaults match Jazu's `<pipeline branch="staging">`. It uses the existing personal-server origin and credentials, with a separate staging bucket and no production Terraform state dependencies.

From the repository root, with Node 22.18+, dependencies installed and Terraform 1.7+ on PATH:

```sh
npm run tf:staging -- plan
npm run tf:staging -- apply
```

`setup.ts` bundles the Worker before running Terraform. `TERRAFORM_BIN` may point to a custom Terraform executable. Apply uses Terraform's normal review prompt; flags are forwarded if needed. Run provisioning from one machine and preserve its state. See [the Pi deployment guide](../../docs/infra-staging.md) for the full post-merge sequence and `.env` inputs. The helper does not create API tokens, HMAC secrets or Access tokens; it reuses the configured values.

The generated Worker bundle contains no injected secrets. Only Terraform state/plan contain the sensitive bindings. Local state, tfvars, saved plans and provider caches are ignored; the provider lock file is committed. The initial static Pages deployment remains the job of the staging XML pipeline. Domain/certificate activation may remain pending until Cloudflare completes verification.

## Validation without provisioning

```sh
node terraform/staging/setup.ts validate
node terraform/staging/setup.ts test
terraform -chdir=terraform/staging fmt -check -recursive
```

`test` uses a mocked Cloudflare provider: no live resources are created or destroyed, and no credentials are needed. It checks staging isolation, Pages branch/domain/DNS, the actual allocated Pages origin, R2/route bindings and the secret names. The Node regression test checks `.env` alias precedence. `content_sha256` ensures rebuilt Worker code triggers a Terraform update even when the bundle path stays the same.

## Existing manually provisioned staging resources

Only import resources that already exist. Replace the identifiers with their actual values; import before the first apply:

```sh
npm run tf:staging -- import cloudflare_pages_project.site ACCOUNT_ID/jazu-staging
npm run tf:staging -- import cloudflare_r2_bucket.assets ACCOUNT_ID/jazu-staging-assets/default
npm run tf:staging -- import cloudflare_pages_domain.site ACCOUNT_ID/jazu-staging/staging.jasouza.com
npm run tf:staging -- import cloudflare_dns_record.site ZONE_ID/DNS_RECORD_ID
npm run tf:staging -- import cloudflare_workers_script.router ACCOUNT_ID/jazu_staging_router
npm run tf:staging -- import cloudflare_workers_script_subdomain.router ACCOUNT_ID/jazu_staging_router
npm run tf:staging -- import cloudflare_workers_route.router ZONE_ID/ROUTE_ID
```

Then plan and apply to reconcile bindings and upload the bundled Worker. Do not import production resources into this state. If staging was already managed by another Terraform state, transfer ownership rather than managing it from two states.

Provider references: [Pages domain](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/pages_domain), [DNS record](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/dns_record), [Worker script and secret bindings](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/workers_script).
