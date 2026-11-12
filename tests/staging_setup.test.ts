/* Infrastructure entry must reuse private credentials without generating secret files or overriding explicit TF inputs. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { staging_environment } from "../terraform/staging/setup.ts"

test("staging setup maps existing private environment names and preserves explicit Terraform inputs", () => {
    const source = { CLOUDFLARE_API_TOKEN: "api-test", CLOUDFLARE_ACCOUNT_ID: "account-test", CLOUDFLARE_ZONE_ID: "zone-test", HMAC_SECRET: "legacy-hmac-test", ORIGIN_HMAC_SECRET: "origin-hmac-test", ACCESS_CLIENT_ID: "client-test", ACCESS_CLIENT_SECRET: "secret-test", TF_VAR_access_client_id: "explicit-client-test", TF_VAR_pages_project: "production-project" }
    const env = staging_environment(source, "/cache/worker.js")
    assert.equal(env.CLOUDFLARE_API_TOKEN, "api-test")
    assert.equal(env.TF_VAR_account_id, "account-test")
    assert.equal(env.TF_VAR_zone_id, "zone-test")
    assert.equal(env.TF_VAR_origin_hmac_secret, "origin-hmac-test")
    assert.equal(env.TF_VAR_access_client_id, "explicit-client-test")
    assert.equal(env.TF_VAR_access_client_secret, "secret-test")
    assert.equal(env.TF_VAR_worker_bundle, "/cache/worker.js")
    assert.equal(env.TF_VAR_staging_pages_project, undefined, "production variable names must not override staging defaults")
    assert.equal(staging_environment({ HMAC_SECRET: "legacy-test" }, "/worker.js").TF_VAR_origin_hmac_secret, "legacy-test")
    assert.equal("TF_VAR_account_id" in source, false)
})
