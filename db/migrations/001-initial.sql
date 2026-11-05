-- 001-initial.sql: users, sessions, password_reset_tokens, trips (T-SQL / Azure SQL).
-- Idempotent: every object is guarded, so re-running is a no-op.

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.users (
  id              uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  email           nvarchar(320)    NOT NULL UNIQUE,
  password_hash   nvarchar(255)    NOT NULL,
  email_verified  bit              NOT NULL DEFAULT 0,
  failed_attempts int              NOT NULL DEFAULT 0,
  locked_until    datetimeoffset   NULL,
  created_at      datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID(N'dbo.sessions', N'U') IS NULL
CREATE TABLE dbo.sessions (
  token      nvarchar(128)    NOT NULL PRIMARY KEY,
  user_id    uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  expires_at datetimeoffset   NOT NULL,
  created_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID(N'dbo.password_reset_tokens', N'U') IS NULL
CREATE TABLE dbo.password_reset_tokens (
  token      nvarchar(128)    NOT NULL PRIMARY KEY,
  user_id    uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  expires_at datetimeoffset   NOT NULL,
  used       bit              NOT NULL DEFAULT 0
);
GO

-- data holds the Trip / TripsState shape (src/domain/trip/types.ts) as JSON text.
IF OBJECT_ID(N'dbo.trips', N'U') IS NULL
CREATE TABLE dbo.trips (
  id         uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  user_id    uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  data       nvarchar(max)    NOT NULL CHECK (ISJSON(data) = 1),
  updated_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_trips_user_id' AND object_id = OBJECT_ID(N'dbo.trips'))
CREATE INDEX IX_trips_user_id ON dbo.trips(user_id);
GO
