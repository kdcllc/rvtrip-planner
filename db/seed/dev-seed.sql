-- LOCAL DEVELOPMENT ONLY. Applied by the db-init service in docker-compose.yml, never by
-- scripts/db-migrate.sh and never in Azure. Creates one sign-in so a fresh local database
-- is usable without registering:
--   email:    admin@example.com
--   password: local-dev-password
-- The hash below is that public throwaway password (scrypt, same format as
-- api/src/shared/password.ts). Idempotent: an existing account is left untouched.
SET NOCOUNT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'admin@example.com')
  INSERT INTO dbo.users (email, password_hash, email_verified)
  VALUES (N'admin@example.com', N'scrypt$131072$8$1$DMF/N869zCjDYQFa30lT/A==$6N3smi8VWxUnRd16T/YeZISE6CMmll57A9r9VHDTiLAOdU3QX0xqct+2R9UWsCG8fqC1pWX5/OB8Qof11JTojA==', 1);
GO
