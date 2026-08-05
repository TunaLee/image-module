import "server-only";

import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import { getServerEnv } from "./env";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
};

export type SessionUser = Pick<User, "id" | "email">;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getSql() {
  return neon(getServerEnv().DATABASE_URL);
}

export async function initializeSchema() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE CHECK (email = LOWER(BTRIM(email))),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
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
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS inspections_user_created_at_idx
    ON inspections (user_id, created_at DESC)
  `;
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const sql = getSql();
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
  const sql = getSql();
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
  const sql = getSql();
  await sql`
    INSERT INTO sessions (id, token_hash, user_id, expires_at)
    VALUES (${randomUUID()}, ${tokenHash}, ${userId}, ${expiresAt.toISOString()})
  `;
}

export async function findSessionUser(tokenHash: string): Promise<SessionUser | null> {
  const sql = getSql();
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
  const sql = getSql();
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}
