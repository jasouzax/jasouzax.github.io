# Cloud preflight

`node src/main.ts cloud --preflight` loads `.env`, validates manual Google/HMAC/Cloudflare inputs, discovers the account when unambiguous, matches the site's zone, and checks read access to Pages, Workers, R2, KV, D1, DNS, Access and Tunnels. Ordinary cloud deployment runs this before the build or Terraform. `--dry_run` remains offline and does not provision configuration.

The read-only probes do not prove write permissions. Cloudflare's [permission reference](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) lists the edit scopes that Terraform still needs. Multiple visible accounts require an explicit account ID. Google console configuration and consent remain manual.

After successful probes, generated account/zone IDs, owner email, VAPID keys and a JWT signing secret are persisted in marked `.env` blocks. Existing nonempty file or environment values win. Partial VAPID pairs fail instead of rotating. No values are logged. Tests use synthetic tokens, denied responses and temporary directories.

Access service-token and Tunnel provisioning are still absent from the main Terraform root. Existing deployments must retain their credentials and imported state. This does not claim a two-variable clean-account bootstrap or change live infrastructure.
