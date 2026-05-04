terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    # Large company would use a remote bucket for state
    # bucket = "ashbi-terraform-state"
    # key    = "prod/terraform.tfstate"
    # region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# --- VPC & Networking ---
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name = "ashbi-prod-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true

  tags = {
    Environment = "production"
    Application = "ashbi-platform"
  }
}

# --- Database (RDS PostgreSQL) ---
resource "aws_db_instance" "postgres" {
  identifier        = "ashbi-prod-db"
  engine            = "postgres"
  engine_version    = "15"
  instance_class    = "db.t4g.medium"
  allocated_storage = 20
  storage_type      = "gp3"
  
  db_name  = "ashbihub"
  username = var.db_username
  password = var.db_password

  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  
  skip_final_snapshot = true
  publicly_accessible = false
}

# --- Redis (Elasticache) ---
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "ashbi-prod-redis"
  engine               = "redis"
  node_type            = "cache.t4g.small"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = module.vpc.elasticache_subnet_group_name
  security_group_ids   = [aws_security_group.redis.id]
}

# --- Application (ECS Fargate) ---
resource "aws_ecs_cluster" "main" {
  name = "ashbi-prod-cluster"
}

resource "aws_ecs_service" "app" {
  name            = "ashbi-platform"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"
  desired_count   = 2

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3002
  }
}

# --- Security Groups ---
resource "aws_security_group" "app" {
  name   = "ashbi-app-sg"
  vpc_id = module.vpc.vpc_id
  
  ingress {
    from_port   = 3002
    to_port     = 3002
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # In reality, only from ALB
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "ashbi-db-sg"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_security_group" "redis" {
  name   = "ashbi-redis-sg"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}
