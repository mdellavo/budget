resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!#%&*()-_=+"
}

# DB password
resource "aws_secretsmanager_secret" "db_password" {
  name = "${var.app_name}/${var.environment}/db-password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db_password.result
}

# Anthropic API key
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name = "${var.app_name}/${var.environment}/anthropic-api-key"
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}

# JWT secret key
resource "aws_secretsmanager_secret" "secret_key" {
  name = "${var.app_name}/${var.environment}/secret-key"
}

resource "aws_secretsmanager_secret_version" "secret_key" {
  secret_id     = aws_secretsmanager_secret.secret_key.id
  secret_string = var.secret_key
}

# Google OAuth client ID
resource "aws_secretsmanager_secret" "google_client_id" {
  name = "${var.app_name}/${var.environment}/google-client-id"
}

resource "aws_secretsmanager_secret_version" "google_client_id" {
  secret_id     = aws_secretsmanager_secret.google_client_id.id
  secret_string = var.google_client_id
}

# Full DATABASE_URL — built after RDS is created
resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.app_name}/${var.environment}/database-url"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql+asyncpg://budget:${random_password.db_password.result}@${aws_db_instance.postgres.address}:5432/budget"
}
