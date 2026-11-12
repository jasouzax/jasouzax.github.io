mock_provider "cloudflare" {
  mock_resource "cloudflare_pages_project" {
    defaults = { subdomain = "allocated-staging-123.pages.dev" }
  }
}

variables {
  account_id            = "test-account"
  zone_id               = "test-zone"
  worker_bundle         = "tests/fixtures/worker.js"
  origin_hmac_secret    = "test-hmac-secret-with-more-than-32-characters"
  access_client_id      = "test-client-id"
  access_client_secret  = "test-client-secret"
  project_clone_origins = "{\"demo\":\"https://github.com/team/demo.git\"}"
}

run "staging_resources_and_routing" {
  command = apply

  assert {
    condition     = cloudflare_pages_project.site.name == "jazu-staging" && cloudflare_pages_project.site.production_branch == "staging"
    error_message = "Staging needs a separate Pages project whose production branch is staging."
  }
  assert {
    condition     = cloudflare_r2_bucket.assets.name == "jazu-staging-assets"
    error_message = "Staging must not upload to the production bucket."
  }
  assert {
    condition     = cloudflare_dns_record.site.name == "staging.jasouza.com" && cloudflare_dns_record.site.proxied && cloudflare_dns_record.site.content == cloudflare_pages_project.site.subdomain
    error_message = "The staging hostname must route through Cloudflare to the allocated Pages hostname."
  }
  assert {
    condition     = cloudflare_pages_domain.site.project_name == cloudflare_pages_project.site.name && cloudflare_pages_domain.site.name == cloudflare_dns_record.site.name
    error_message = "The DNS hostname must also be associated with the Pages project."
  }
  assert {
    condition     = cloudflare_workers_route.router.pattern == "staging.jasouza.com/*" && cloudflare_workers_route.router.script == cloudflare_workers_script.router.script_name && !cloudflare_workers_script_subdomain.router.enabled
    error_message = "Only the staging domain should route to this Worker."
  }
  assert {
    condition     = one([for binding in cloudflare_workers_script.router.bindings : binding.text if binding.name == "PAGES_ORIGIN"]) == "https://allocated-staging-123.pages.dev"
    error_message = "Use the actual allocated Pages origin rather than guessing its hostname."
  }
  assert {
    condition     = one([for binding in cloudflare_workers_script.router.bindings : binding.bucket_name if binding.name == "ASSETS"]) == cloudflare_r2_bucket.assets.name
    error_message = "The staging Worker must serve its own R2 bucket."
  }
  assert {
    condition     = one([for binding in cloudflare_workers_script.router.bindings : binding.text if binding.name == "PROJECT_CLONE_ORIGINS"]) == var.project_clone_origins
    error_message = "The Worker needs the XML-derived public clone origins for provider-first reads."
  }
  assert {
    condition     = toset([for binding in cloudflare_workers_script.router.bindings : binding.name if binding.type == "secret_text"]) == toset(["ORIGIN_HMAC_SECRET", "ACCESS_CLIENT_ID", "ACCESS_CLIENT_SECRET"])
    error_message = "Provision all three personal-origin secrets with the Worker."
  }
}
