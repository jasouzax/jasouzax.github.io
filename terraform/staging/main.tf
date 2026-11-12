# This root owns staging only. It never references production Terraform resources/state.
resource "cloudflare_pages_project" "site" {
  account_id        = var.account_id
  name              = var.staging_pages_project
  production_branch = var.staging_branch
}

resource "cloudflare_r2_bucket" "assets" {
  account_id = var.account_id
  name       = var.staging_assets_bucket_name
}

resource "cloudflare_pages_domain" "site" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.site.name
  name         = var.staging_domain
}

resource "cloudflare_dns_record" "site" {
  zone_id = var.zone_id
  name    = var.staging_domain
  type    = "CNAME"
  content = cloudflare_pages_project.site.subdomain
  proxied = true
  ttl     = 1
  # Associate the hostname with Pages before routing traffic to it.
  depends_on = [cloudflare_pages_domain.site]
}

resource "cloudflare_workers_script" "router" {
  account_id         = var.account_id
  script_name        = var.staging_worker_name
  main_module        = "worker.js"
  content_file       = var.worker_bundle
  content_sha256     = filesha256(var.worker_bundle)
  compatibility_date = var.compatibility_date

  bindings = [
    { name = "DOMAIN", type = "plain_text", text = var.staging_domain },
    { name = "PAGES_ORIGIN", type = "plain_text", text = "https://${cloudflare_pages_project.site.subdomain}" },
    { name = "PUBLIC_PROJECTS", type = "plain_text", text = var.public_projects },
    { name = "PUBLIC_PROJECTS_MANIFEST", type = "plain_text", text = "/projects/git.json" },
    { name = "PROJECT_CLONE_ORIGINS", type = "plain_text", text = var.project_clone_origins },
    { name = "PERSONAL_ORIGIN", type = "plain_text", text = var.personal_origin },
    { name = "ASSETS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.assets.name },
    { name = "ORIGIN_HMAC_SECRET", type = "secret_text", text = var.origin_hmac_secret },
    { name = "ACCESS_CLIENT_ID", type = "secret_text", text = var.access_client_id },
    { name = "ACCESS_CLIENT_SECRET", type = "secret_text", text = var.access_client_secret },
  ]
}

resource "cloudflare_workers_script_subdomain" "router" {
  account_id       = var.account_id
  script_name      = cloudflare_workers_script.router.script_name
  enabled          = false
  previews_enabled = false
}

resource "cloudflare_workers_route" "router" {
  zone_id    = var.zone_id
  pattern    = "${var.staging_domain}/*"
  script     = cloudflare_workers_script.router.script_name
  depends_on = [cloudflare_dns_record.site]
}
