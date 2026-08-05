import "server-only";

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

import {
  deleteSession,
  findSessionUser,
  insertSession,
  type SessionUser,
} from "./db";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE_NAME = "inspection_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;

  return `${salt.toString("base64url")}:${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [encodedSalt, encodedKey, ...unexpectedParts] = storedHash.split(":");

  if (!encodedSalt || !encodedKey || unexpectedParts.length > 0) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expectedKey = Buffer.from(encodedKey, "base64url");
    if (salt.length !== PASSWORD_SALT_BYTES || expectedKey.length !== PASSWORD_KEY_LENGTH) {
      return false;
    }

    const actualKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await insertSession(userId, hashSessionToken(token), expiresAt);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return token ? findSessionUser(hashSessionToken(token)) : null;
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deleteSession(hashSessionToken(token));
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
