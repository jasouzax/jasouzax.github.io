variable "account_id" { type = string }
variable "zone_id" { type = string }
variable "worker_bundle" { type = string }
variable "registry_domain" {
  type    = string
  default = "registry.jasouza.com"
}
variable "registry_bucket" {
  type    = string
  default = "jazu-registry"
}
