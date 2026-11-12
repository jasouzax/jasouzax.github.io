terraform {
  required_version = ">= 1.7"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
  # Separate state from terraform/ (production). State contains Worker secrets.
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}
