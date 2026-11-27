-- 003-vehicle-profiles-fuel-prices.sql: one RV/vehicle profile per user, weekly EIA fuel price cache.
-- Idempotent: every statement is guarded, so re-running is a no-op.

IF OBJECT_ID(N'dbo.vehicle_profiles', N'U') IS NULL
CREATE TABLE dbo.vehicle_profiles (
  user_id    uniqueidentifier NOT NULL PRIMARY KEY REFERENCES dbo.users(id),
  data       nvarchar(max)    NOT NULL CHECK (ISJSON(data) = 1),
  updated_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID(N'dbo.fuel_price_weekly', N'U') IS NULL
CREATE TABLE dbo.fuel_price_weekly (
  area       nvarchar(8)      NOT NULL,
  product    nvarchar(16)     NOT NULL,
  week       date             NOT NULL,
  price      decimal(6,3)     NOT NULL,
  fetched_at datetimeoffset   NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (area, product, week)
);
GO
