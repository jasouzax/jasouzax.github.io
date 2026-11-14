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

variable "project_clone_origins" {
  type        = string
  default     = "{}"
  description = "Public HTTPS Git read origins derived from the project's XML repo attributes."
}

variable "work_fallback_key" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{43}$", var.work_fallback_key))
    error_message = "Provide a persistent random 32-byte base64url WORK_FALLBACK_KEY, separate from D1."
  }
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "google_admin_email" {
  type    = string
  default = "jason@jasouza.com"
}

variable "work_migrations_enabled" {
  type        = bool
  default     = true
  description = "Apply D1 migrations before uploading the Worker. Disable only for mocked tests."
}

variable "work_owner_email" {
  type    = string
  default = "jason@jasouza.com"
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
