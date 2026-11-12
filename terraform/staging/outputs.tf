output "staging_url" {
  value = "https://${var.staging_domain}"
}

output "pages_origin" {
  value = "https://${cloudflare_pages_project.site.subdomain}"
}

output "assets_bucket" {
  value = cloudflare_r2_bucket.assets.name
}

output "worker_name" {
  value = cloudflare_workers_script.router.script_name
}

output "domain_status" {
  value = cloudflare_pages_domain.site.status
}
