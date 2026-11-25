// Single-use invite codes: only SHA-256 hashes are stored; the plain code exists only in the
// emailed link. Consumption is atomic with user creation (one T-SQL batch, see below).
import { createHash, randomBytes } from 'node:crypto'
import { query, sql } from './db'
import type { SqlParams } from './db'

export const INVITE_CODE_TTL_DAYS = 14

/** 192 random bits as a base64url string (32 chars). */
export function generateInviteCode(): string {
  return randomBytes(24).toString('base64url')
}

/** Hex SHA-256 (64 chars) of the code; this is the only form that reaches the database. */
export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Revokes every unused code of the request, then inserts a fresh one valid for 14 days. */
export async function issueInviteCode(requestId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateInviteCode()
  const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_DAYS * 24 * 60 * 60 * 1000)
  await query(
    `SET XACT_ABORT ON;
     BEGIN TRAN;
     UPDATE dbo.invite_codes SET revoked = 1 WHERE request_id = @requestId AND used_at IS NULL;
     INSERT INTO dbo.invite_codes (code_hash, request_id, expires_at) VALUES (@codeHash, @requestId, @expiresAt);
     COMMIT;`,
    {
      requestId: { type: sql.UniqueIdentifier, value: requestId },
      codeHash: { type: sql.Char(64), value: hashInviteCode(code) },
      expiresAt: { type: sql.DateTimeOffset, value: expiresAt },
    },
  )
  return { code, expiresAt }
}

/** Revokes all unused codes of a request (decline). */
export async function revokeUnusedInviteCodes(requestId: string): Promise<void> {
  await query('UPDATE dbo.invite_codes SET revoked = 1 WHERE request_id = @requestId AND used_at IS NULL', {
    requestId: { type: sql.UniqueIdentifier, value: requestId },
  })
}

/**
 * The atomic consume-and-register batch. Marks the code used, creates the user, links the code
 * to the user and flips the request to 'registered' in one transaction. Returns the new user id
 * as the single recordset row; `id` is NULL when the code is unknown, used, revoked or expired
 * (nothing was changed). A duplicate email raises 2627/2601; XACT_ABORT rolls everything back so
 * the code is not burned.
 */
export function buildRegisterWithInviteCodeBatch(
  code: string,
  email: string,
  passwordHash: string,
): { text: string; params: SqlParams } {
  const text = `SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @req TABLE (request_id uniqueidentifier);
DECLARE @new TABLE (id uniqueidentifier);
UPDATE dbo.invite_codes SET used_at = SYSUTCDATETIME()
  OUTPUT inserted.request_id INTO @req
  WHERE code_hash = @codeHash AND used_at IS NULL AND revoked = 0 AND expires_at > SYSUTCDATETIME();
IF @@ROWCOUNT = 0
BEGIN
  ROLLBACK;
  SELECT CAST(NULL AS uniqueidentifier) AS id;
  RETURN;
END;
INSERT INTO dbo.users (email, password_hash) OUTPUT inserted.id INTO @new VALUES (@email, @passwordHash);
UPDATE dbo.invite_codes SET used_by_user_id = (SELECT TOP 1 id FROM @new) WHERE code_hash = @codeHash;
UPDATE dbo.invite_requests SET status = 'registered' WHERE id = (SELECT TOP 1 request_id FROM @req);
COMMIT;
SELECT id FROM @new;`
  return {
    text,
    params: {
      codeHash: { type: sql.Char(64), value: hashInviteCode(code) },
      email: { type: sql.NVarChar(320), value: email },
      passwordHash: { type: sql.NVarChar(255), value: passwordHash },
    },
  }
}
