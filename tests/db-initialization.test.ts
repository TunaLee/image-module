import { describe, expect, it, vi } from "vitest";

const { sql } = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => sql),
}));

vi.mock("../lib/env", () => ({
  getServerEnv: () => ({
    DATABASE_URL: "postgres://test",
    NVIDIA_API_KEY: "test",
    SESSION_SECRET: "a-session-secret-that-is-at-least-32-characters",
  }),
}));

import { findUserByEmail } from "../lib/db";

describe("database helpers", () => {
  it("initializes the schema before querying users", async () => {
    await findUserByEmail("operator@example.com");

    const statements = sql.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(" ").replace(/\s+/g, " ").trim(),
    );
    const schemaStatementIndex = statements.findIndex((statement) =>
      statement.startsWith("CREATE TABLE IF NOT EXISTS users"),
    );
    const userLookupIndex = statements.findIndex((statement) =>
      statement.startsWith("SELECT id, email, password_hash FROM users"),
    );

    expect(schemaStatementIndex).toBeGreaterThanOrEqual(0);
    expect(userLookupIndex).toBeGreaterThan(schemaStatementIndex);
  });
});
