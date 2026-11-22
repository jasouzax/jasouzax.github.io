variable "account_id" {
  type = string
}

variable "inherited_secret_names" {
  type        = set(string)
  default     = []
  description = "Existing Worker secrets to inherit unchanged when their values are unavailable locally. Confirm each exists before applying."
  validation {
    condition = length(setsubtract(var.inherited_secret_names, toset(["ORIGIN_HMAC_SECRET", "ACCESS_CLIENT_ID", "ACCESS_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "WORK_FALLBACK_KEY", "VAPID_PRIVATE_KEY", "SERVER_AGENT_SECRET", "AUTH_JWT_SECRET"]))) == 0
    error_message = "Only known secret bindings may be inherited."
  }
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

variable "auth_jwt_secret" {
  type      = string
  sensitive = true
  default   = null
  validation {
    condition     = var.auth_jwt_secret == null ? true : length(var.auth_jwt_secret) >= 32
    error_message = "AUTH_JWT_SECRET must contain at least 32 characters."
  }
}

variable "work_fallback_key" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{43}$", var.work_fallback_key))
    error_message = "Provide a persistent random 32-byte base64url WORK_FALLBACK_KEY, separate from D1."
  }
}

variable "vapid_public_key" {
  type    = string
  default = ""
}

variable "vapid_private_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "vapid_subject" {
  type    = string
  default = "mailto:jason@jasouza.com"
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

# The Pi agent (`server/`) signs its WebSocket upgrade with this secret; leave null to keep /server offline on staging.
variable "server_agent_secret" {
  type      = string
  default   = null
  sensitive = true
}

variable "server_owner_emails" {
  type        = string
  default     = null
  description = "Comma-separated e-mails allowed to open the real Pi desk; null means the Google admin e-mail only."
}
