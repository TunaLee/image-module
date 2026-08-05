import "server-only";

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import { getServerEnv } from "./env";
import type { InspectionRecord, OcrResult, VisualResult } from "./types";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
};

export type SessionUser = Pick<User, "id" | "email">;

export type NewInspectionRecord = Omit<InspectionRecord, "id" | "createdAt">;

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaMigrationError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_COLLISION_MARKER = "EQUIPMENT_INSPECTION_EMAIL_COLLISION:";

function getSql() {
  return neon(getServerEnv().DATABASE_URL);
}

let schemaInitialization: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  if (!schemaInitialization) {
    schemaInitialization = initializeSchema().catch((error: unknown) => {
      schemaInitialization = undefined;
      throw error;
    });
  }

  await schemaInitialization;
}

async function getReadySql() {
  await ensureSchema();
  return getSql();
}

export async function initializeSchema() {
  const sql = getSql();

  try {
    await sql.transaction((transactionSql) => [
      transactionSql`SELECT pg_advisory_xact_lock(803522992, 1)`,
      transactionSql`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email TEXT NOT NULL UNIQUE CONSTRAINT users_email_normalized CHECK (email = LOWER(BTRIM(email))),
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      transactionSql`
        CREATE TABLE IF NOT EXISTS sessions (
          id UUID PRIMARY KEY,
          token_hash TEXT NOT NULL CONSTRAINT sessions_token_hash_key UNIQUE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      transactionSql`
        CREATE TABLE IF NOT EXISTS inspections (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          image_path TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('ocr', 'visual', 'both')),
          criterion TEXT,
          ocr_result JSONB,
          visual_result JSONB,
          status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      transactionSql`
        CREATE INDEX IF NOT EXISTS inspections_user_created_at_idx
        ON inspections (user_id, created_at DESC)
      `,
      transactionSql`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
      transactionSql`
        DO $schema_migration$
        DECLARE
          normalized_collisions TEXT;
        BEGIN
          SELECT STRING_AGG(normalized_email, ', ' ORDER BY normalized_email)
          INTO normalized_collisions
          FROM (
            SELECT LOWER(BTRIM(email)) AS normalized_email
            FROM users
            GROUP BY LOWER(BTRIM(email))
            HAVING COUNT(*) > 1
          ) AS collisions;

          IF normalized_collisions IS NOT NULL THEN
            RAISE EXCEPTION USING
              MESSAGE = 'EQUIPMENT_INSPECTION_EMAIL_COLLISION:' || normalized_collisions;
          END IF;
        END
        $schema_migration$
      `,
      transactionSql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_check`,
      transactionSql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_normalized`,
      transactionSql`
        UPDATE users
        SET email = LOWER(BTRIM(email))
        WHERE email <> LOWER(BTRIM(email))
      `,
      transactionSql`
        ALTER TABLE users
        ADD CONSTRAINT users_email_normalized CHECK (email = LOWER(BTRIM(email)))
      `,
      transactionSql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id UUID`,
      transactionSql`UPDATE sessions SET id = gen_random_uuid() WHERE id IS NULL`,
      transactionSql`ALTER TABLE sessions ALTER COLUMN id SET NOT NULL`,
      transactionSql`ALTER TABLE sessions ALTER COLUMN token_hash SET NOT NULL`,
      transactionSql`ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pkey`,
      transactionSql`
        ALTER TABLE sessions
        ADD CONSTRAINT sessions_pkey PRIMARY KEY (id)
      `,
      transactionSql`ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_token_hash_key`,
      transactionSql`
        ALTER TABLE sessions
        ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)
      `,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const markerIndex = message.indexOf(EMAIL_COLLISION_MARKER);

    if (markerIndex >= 0) {
      const normalizedEmails = message
        .slice(markerIndex + EMAIL_COLLISION_MARKER.length)
        .split("\n", 1)[0]
        .trim();
      throw new SchemaMigrationError(
        `Cannot normalize legacy email identities because these values collide: ${normalizedEmails}. Resolve the duplicate accounts before retrying schema initialization.`,
      );
    }

    throw error;
  }
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const sql = await getReadySql();
  const rows = await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${id}, ${normalizedEmail}, ${passwordHash})
    RETURNING id, email, password_hash
  `;
  const user = rows[0];

  if (!user) {
    throw new Error("User creation did not return a user");
  }

  return {
    id: user.id as string,
    email: user.email as string,
    passwordHash: user.password_hash as string,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = normalizeEmail(email);
  const sql = await getReadySql();
  const rows = await sql`
    SELECT id, email, password_hash
    FROM users
    WHERE email = ${normalizedEmail}
    LIMIT 1
  `;
  const user = rows[0];

  return user
    ? {
        id: user.id as string,
        email: user.email as string,
        passwordHash: user.password_hash as string,
      }
    : null;
}

export async function insertSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  const sql = await getReadySql();
  await sql`
    INSERT INTO sessions (id, token_hash, user_id, expires_at)
    VALUES (${randomUUID()}, ${tokenHash}, ${userId}, ${expiresAt.toISOString()})
  `;
}

export async function findSessionUser(tokenHash: string): Promise<SessionUser | null> {
  const sql = await getReadySql();
  const rows = await sql`
    SELECT users.id, users.email
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${tokenHash}
      AND sessions.expires_at > NOW()
    LIMIT 1
  `;
  const user = rows[0];

  return user
    ? { id: user.id as string, email: user.email as string }
    : null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const sql = await getReadySql();
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

function toInspectionRecord(row: Record<string, unknown>): InspectionRecord {
  return {
    id: row.id as string,
    imagePath: row.image_path as string,
    mode: row.mode as InspectionRecord["mode"],
    criterion: (row.criterion as string | null) ?? null,
    ocrResult: (row.ocr_result as OcrResult | null) ?? null,
    visualResult: (row.visual_result as VisualResult | null) ?? null,
    status: row.status as InspectionRecord["status"],
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function createInspectionRecord(
  userId: string,
  record: NewInspectionRecord,
): Promise<InspectionRecord> {
  const sql = await getReadySql();
  const rows = await sql`
    INSERT INTO inspections (
      id, user_id, image_path, mode, criterion, ocr_result, visual_result, status, error_message
    )
    VALUES (
      ${randomUUID()}, ${userId}, ${record.imagePath}, ${record.mode}, ${record.criterion},
      ${record.ocrResult === null ? null : JSON.stringify(record.ocrResult)}::jsonb,
      ${record.visualResult === null ? null : JSON.stringify(record.visualResult)}::jsonb,
      ${record.status}, ${record.errorMessage}
    )
    RETURNING id, image_path, mode, criterion, ocr_result, visual_result, status, error_message, created_at
  `;
  const saved = rows[0];

  if (!saved) {
    throw new Error("Inspection creation did not return a record");
  }

  return toInspectionRecord(saved);
}

export async function listRecentInspectionRecords(userId: string): Promise<InspectionRecord[]> {
  const sql = await getReadySql();
  const rows = await sql`
    SELECT id, image_path, mode, criterion, ocr_result, visual_result, status, error_message, created_at
    FROM inspections
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 6
  `;

  return rows.map((row) => toInspectionRecord(row));
}

export async function findInspectionByIdForUser(
  userId: string,
  inspectionId: string,
): Promise<InspectionRecord | null> {
  const sql = await getReadySql();
  const rows = await sql`
    SELECT id, image_path, mode, criterion, ocr_result, visual_result, status, error_message, created_at
    FROM inspections
    WHERE id = ${inspectionId} AND user_id = ${userId}
    LIMIT 1
  `;

  return rows[0] ? toInspectionRecord(rows[0]) : null;
}
