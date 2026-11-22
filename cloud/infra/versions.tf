terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    # R2 is S3-compatible; the Cloudflare provider has no R2 object resource.
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state by default. For team use, replace with a remote backend
  # (for example an R2 bucket through the s3 backend); never commit state.
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}

provider "aws" {
  region     = "auto"
  access_key = var.r2_access_key_id
  secret_key = var.r2_secret_access_key

  endpoints {
    s3 = "https://${var.account_id}.r2.cloudflarestorage.com"
  }

  skip_credentials_validation = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  s3_use_path_style           = true
}
