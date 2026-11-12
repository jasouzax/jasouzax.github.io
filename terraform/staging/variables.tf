variable "account_id" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "worker_bundle" {
  type        = string
  description = "Worker module bundled by setup.ts before Terraform runs."
}

variable "staging_domain" {
  type    = string
  default = "staging.jasouza.com"
}

variable "staging_pages_project" {
  type    = string
  default = "jazu-staging"
}

variable "staging_assets_bucket_name" {
  type    = string
  default = "jazu-staging-assets"
}

variable "staging_worker_name" {
  type    = string
  default = "jazu_staging_router"
}

variable "staging_branch" {
  type    = string
  default = "staging"
}

variable "personal_origin" {
  type    = string
  default = "https://personal-server.jasouza.com"
}

variable "public_projects" {
  type    = string
  default = "[\"jazu\"]"
}

variable "compatibility_date" {
  type    = string
  default = "2026-11-04"
}

variable "origin_hmac_secret" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.origin_hmac_secret) >= 32
    error_message = "Use the existing Pi origin HMAC secret (at least 32 characters)."
  }
}

variable "access_client_id" {
  type      = string
  sensitive = true
  validation {
    condition     = length(trimspace(var.access_client_id)) > 0
    error_message = "Reuse the existing Cloudflare Access service-token client id."
  }
}

variable "access_client_secret" {
  type      = string
  sensitive = true
  validation {
    condition     = length(trimspace(var.access_client_secret)) > 0
    error_message = "Reuse the existing Cloudflare Access service-token secret."
  }
}
