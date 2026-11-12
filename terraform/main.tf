locals {
  pages_origin = coalesce(var.pages_origin, "https://${cloudflare_pages_project.site.subdomain}")

  plain_bindings = concat(
    [
      { name = "DOMAIN", type = "plain_text", text = var.domain },
      { name = "PAGES_ORIGIN", type = "plain_text", text = local.pages_origin },
      { name = "PUBLIC_PROJECTS", type = "plain_text", text = var.public_projects },
      { name = "PUBLIC_PROJECTS_MANIFEST", type = "plain_text", text = "/projects/git.json" },
    ],
    var.personal_origin == null ? [] : [{ name = "PERSONAL_ORIGIN", type = "plain_text", text = var.personal_origin }],
  )

  secret_bindings = concat(
    var.origin_hmac_secret == null ? [] : [{ name = "ORIGIN_HMAC_SECRET", type = "secret_text", text = var.origin_hmac_secret }],
    var.access_client_id == null ? [] : [{ name = "ACCESS_CLIENT_ID", type = "secret_text", text = var.access_client_id }],
    var.access_client_secret == null ? [] : [{ name = "ACCESS_CLIENT_SECRET", type = "secret_text", text = var.access_client_secret }],
  )

  resource_bindings = [
    { name = "ASSETS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.assets.name },
    { name = "REGISTRY", type = "kv_namespace", namespace_id = cloudflare_workers_kv_namespace.registry.id },
    { name = "DB", type = "d1", id = cloudflare_d1_database.db.id },
  ]

  route_patterns = ["${var.domain}/*", "*.${var.domain}/*"]
}

# ---- Storage ----
resource "cloudflare_r2_bucket" "assets" {
  account_id = var.account_id
  name       = var.assets_bucket_name
}

resource "cloudflare_workers_kv_namespace" "registry" {
  account_id = var.account_id
  title      = var.kv_namespace_title
}

resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = var.d1_database_name
}

# ---- Pages project (content is uploaded by `deploy`, see README) ----
resource "cloudflare_pages_project" "site" {
  account_id        = var.account_id
  name              = var.pages_project
  production_branch = var.production_branch
}

# ---- Large media -> R2 ----
resource "aws_s3_object" "large_assets" {
  for_each = { for asset in var.large_assets : asset.key => asset }

  bucket       = cloudflare_r2_bucket.assets.name
  key          = each.value.key
  source       = each.value.file
  etag         = filemd5(each.value.file)
  content_type = each.value.content_type
}

# ---- Worker ----
resource "cloudflare_workers_script" "router" {
  account_id         = var.account_id
  script_name        = var.worker_name
  main_module        = "worker.js"
  content            = file(var.worker_bundle)
  compatibility_date = var.compatibility_date

  bindings = concat(local.plain_bindings, local.resource_bindings, local.secret_bindings)
}

resource "cloudflare_workers_script_subdomain" "router" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.router.script_name
  enabled     = var.workers_dev
}

resource "cloudflare_workers_route" "router" {
  for_each = toset(local.route_patterns)

  zone_id = var.zone_id
  pattern = each.value
  script  = cloudflare_workers_script.router.script_name
}

# ---- D1 migrations (applied through the D1 HTTP API; tracked in d1_migrations) ----
resource "terraform_data" "d1_migrations" {
  triggers_replace = {
    database   = cloudflare_d1_database.db.id
    migrations = sha256(join("", [for f in sort(fileset("${path.module}/../migrations", "*.sql")) : filesha256("${path.module}/../migrations/${f}")]))
  }

  provisioner "local-exec" {
    command     = "node src/node/d1_migrate.ts"
    working_dir = "${path.module}/.."
    environment = {
      CLOUDFLARE_ACCOUNT_ID = var.account_id
      D1_DATABASE_ID        = cloudflare_d1_database.db.id
    }
  }
}
