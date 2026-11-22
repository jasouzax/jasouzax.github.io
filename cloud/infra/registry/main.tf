resource "cloudflare_r2_bucket" "images" {
  account_id = var.account_id
  name       = var.registry_bucket
}
resource "cloudflare_workers_script" "registry" {
  account_id         = var.account_id
  script_name        = "jazu_registry"
  main_module        = "registry.js"
  content_file       = var.worker_bundle
  content_sha256     = filesha256(var.worker_bundle)
  compatibility_date = "2026-11-04"
  bindings = concat([
    { name = "DOMAIN", type = "plain_text", text = var.registry_domain },
    { name = "BLOBS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.images.name },
  ], var.legacy_registry_domain == null ? [] : [{ name = "LEGACY_DOMAIN", type = "plain_text", text = var.legacy_registry_domain }], var.repository_bindings)
}
resource "cloudflare_workers_custom_domain" "registry" {
  account_id = var.account_id
  hostname   = var.registry_domain
  service    = cloudflare_workers_script.registry.script_name
  zone_id    = var.zone_id
  lifecycle { create_before_destroy = true }
}
resource "cloudflare_workers_custom_domain" "legacy_registry" {
  count      = var.legacy_registry_domain == null ? 0 : 1
  account_id = var.account_id
  hostname   = var.legacy_registry_domain
  service    = cloudflare_workers_script.registry.script_name
  zone_id    = var.zone_id
  depends_on = [cloudflare_workers_custom_domain.registry]
}
output "registry" { value = var.registry_domain }

# OCI clients are not browsers. Scope this setting to anonymous reads on the dedicated registry API.
resource "cloudflare_ruleset" "registry_clients" {
  zone_id = var.zone_id
  name    = "Jazu registry API configuration"
  kind    = "zone"
  phase   = "http_config_settings"
  rules = [{
    ref               = "registry_oci_reads"
    description       = "Allow non-browser OCI read clients on the dedicated registry"
    expression        = "(http.host in {${join(" ", [for host in compact([var.registry_domain, var.legacy_registry_domain]) : jsonencode(host)])}} and (http.request.uri.path eq \"/v2\" or starts_with(http.request.uri.path, \"/v2/\")) and http.request.method in {\"GET\" \"HEAD\"})"
    action            = "set_config"
    action_parameters = { bic = false }
    enabled           = true
  }]
}

resource "cloudflare_workers_route" "repository" {
  zone_id = var.zone_id
  pattern = "${var.registry_domain}/*"
  script  = cloudflare_workers_script.registry.script_name
}

resource "cloudflare_workers_route" "legacy_repository" {
  count      = var.legacy_registry_domain == null ? 0 : 1
  zone_id    = var.zone_id
  pattern    = "${var.legacy_registry_domain}/*"
  script     = cloudflare_workers_script.registry.script_name
  depends_on = [cloudflare_workers_custom_domain.legacy_registry]
}
