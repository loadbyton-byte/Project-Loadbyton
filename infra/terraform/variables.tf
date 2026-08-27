variable "project" { type = string; default = "loadbyton" }
variable "env" { type = string; default = "production" } # development | staging | production
variable "aws_region" { type = string; default = "me-central-1" } # UAE
variable "db_username" { type = string; sensitive = true }
variable "db_password" { type = string; sensitive = true }
variable "stripe_secret_key" { type = string; sensitive = true; default = "" }
variable "sentry_dsn" { type = string; sensitive = true; default = "" }
