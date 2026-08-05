import { describe, expect, it } from "vitest";

import {
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../lib/auth";
import { normalizeEmail } from "../lib/db";

describe("credentials", () => {
  it("verifies the correct password only", async () => {
    const stored = await hashPassword("long-enough-password");

    await expect(
      verifyPassword("long-enough-password", stored),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
  });

  it("does not retain a raw session token", () => {
    expect(hashSessionToken("session-token")).not.toBe("session-token");
  });

  it("normalizes email identity keys before database access", () => {
    expect(normalizeEmail("  Operator@Example.COM  ")).toBe("operator@example.com");
  });
});
