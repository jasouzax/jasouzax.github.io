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
  bindings = [
    { name = "DOMAIN", type = "plain_text", text = var.registry_domain },
    { name = "BLOBS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.images.name },
  ]
}
resource "cloudflare_workers_custom_domain" "registry" {
  account_id = var.account_id
  hostname   = var.registry_domain
  service    = cloudflare_workers_script.registry.script_name
  zone_id    = var.zone_id
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
    expression        = "(http.host eq ${jsonencode(var.registry_domain)} and (http.request.uri.path eq \"/v2\" or starts_with(http.request.uri.path, \"/v2/\")) and http.request.method in {\"GET\" \"HEAD\"})"
    action            = "set_config"
    action_parameters = { bic = false }
    enabled           = true
  }]
}
