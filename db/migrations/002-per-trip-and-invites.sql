-- 002-per-trip-and-invites.sql: one row per trip, current trip per user, invite requests/codes.
-- Idempotent: every statement is guarded, so re-running is a no-op.
-- dbo.trips (one JSON blob per user) is LEGACY and READ-ONLY after 002: it is kept untouched
-- for rollback safety and is only read by the backfill below.

IF OBJECT_ID(N'dbo.user_trips', N'U') IS NULL
CREATE TABLE dbo.user_trips (
  user_id    uniqueidentifier NOT NULL REFERENCES dbo.users(id),
  trip_id    nvarchar(128)    NOT NULL,
  data       nvarchar(max)    NOT NULL CHECK (ISJSON(data) = 1),
  version    int              NOT NULL DEFAULT 1,
  created_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (user_id, trip_id)
);
GO

IF COL_LENGTH(N'dbo.users', N'current_trip_id') IS NULL
ALTER TABLE dbo.users ADD current_trip_id nvarchar(128) NULL;
GO

IF OBJECT_ID(N'dbo.invite_requests', N'U') IS NULL
CREATE TABLE dbo.invite_requests (
  id           uniqueidentifier NOT NULL PRIMARY KEY DEFAULT NEWID(),
  email        nvarchar(320)    NOT NULL UNIQUE,
  name         nvarchar(200)    NOT NULL,
  note         nvarchar(1000)   NULL,
  status       nvarchar(16)     NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','invited','declined','registered')),
  ip_hash      char(64)         NULL,
  created_at   datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME(),
  invited_at   datetimeoffset   NULL,
  invite_count int              NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_invite_requests_ip_hash_created_at' AND object_id = OBJECT_ID(N'dbo.invite_requests'))
CREATE INDEX IX_invite_requests_ip_hash_created_at ON dbo.invite_requests(ip_hash, created_at);
GO

IF OBJECT_ID(N'dbo.invite_codes', N'U') IS NULL
CREATE TABLE dbo.invite_codes (
  code_hash        char(64)         NOT NULL PRIMARY KEY, -- hex SHA-256
  request_id       uniqueidentifier NOT NULL REFERENCES dbo.invite_requests(id),
  expires_at       datetimeoffset   NOT NULL,
  used_at          datetimeoffset   NULL,
  used_by_user_id  uniqueidentifier NULL REFERENCES dbo.users(id),
  revoked          bit              NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_invite_codes_request_id' AND object_id = OBJECT_ID(N'dbo.invite_codes'))
CREATE INDEX IX_invite_codes_request_id ON dbo.invite_codes(request_id);
GO

-- Backfill from legacy dbo.trips. Newest blob first (updated_at DESC), so for a duplicate trip id
-- the newest blob's element wins. Elements without an id or with an id > 128 chars are skipped.
-- Dynamic SQL keeps the batch parseable regardless of object creation order.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

EXEC (N'
;WITH elems AS (
  SELECT t.user_id,
         JSON_VALUE(j.value, ''$.id'') AS trip_id,
         j.value AS data,
         ROW_NUMBER() OVER (
           PARTITION BY t.user_id, JSON_VALUE(j.value, ''$.id'')
           ORDER BY t.updated_at DESC, t.id, CAST(j.[key] AS int)) AS rn
  FROM dbo.trips t
  CROSS APPLY OPENJSON(t.data, ''$.trips'') j
  WHERE j.type = 5
)
INSERT INTO dbo.user_trips (user_id, trip_id, data)
SELECT e.user_id, e.trip_id, e.data
FROM elems e
WHERE e.rn = 1
  AND e.trip_id IS NOT NULL AND LEN(e.trip_id) BETWEEN 1 AND 128
  AND NOT EXISTS (SELECT 1 FROM dbo.user_trips u WHERE u.user_id = e.user_id AND u.trip_id = e.trip_id);
');

EXEC (N'
;WITH newest AS (
  SELECT t.user_id,
         JSON_VALUE(t.data, ''$.currentTripId'') AS current_trip_id,
         ROW_NUMBER() OVER (PARTITION BY t.user_id ORDER BY t.updated_at DESC, t.id) AS rn
  FROM dbo.trips t
)
UPDATE u SET current_trip_id = n.current_trip_id
FROM dbo.users u
JOIN newest n ON n.user_id = u.id AND n.rn = 1
WHERE u.current_trip_id IS NULL
  AND n.current_trip_id IS NOT NULL AND LEN(n.current_trip_id) BETWEEN 1 AND 128;
');

COMMIT TRANSACTION;
GO
