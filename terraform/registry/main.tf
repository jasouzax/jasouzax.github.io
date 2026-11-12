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
