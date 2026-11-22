output "pages_origin" {
  value = local.pages_origin
}

output "assets_bucket" {
  value = cloudflare_r2_bucket.assets.name
}

output "kv_namespace_id" {
  value = cloudflare_workers_kv_namespace.registry.id
}

output "d1_database_id" {
  value = cloudflare_d1_database.db.id
}
