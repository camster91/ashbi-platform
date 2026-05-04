variable "aws_region" {
  description = "The AWS region to deploy to"
  type        = string
  default     = "us-east-1"
}

variable "db_username" {
  description = "The database admin username"
  type        = string
  default     = "ashbihub"
}

variable "db_password" {
  description = "The database admin password"
  type        = string
  sensitive   = true
}
