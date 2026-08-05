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

import { initializeSchema } from "../lib/db";

describe("initializeSchema", () => {
  it("migrates legacy sessions to a UUID primary key and unique token hash", async () => {
    await initializeSchema();

    const statements = sql.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(" ").replace(/\s+/g, " ").trim(),
    );

    expect(statements).toContain("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id UUID");
    expect(statements).toContain(
      "UPDATE sessions SET id = gen_random_uuid() WHERE id IS NULL",
    );
    expect(statements).toContain("ALTER TABLE sessions ALTER COLUMN id SET NOT NULL");
    expect(statements).toContain(
      "ALTER TABLE sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id)",
    );
    expect(statements).toContain(
      "ALTER TABLE sessions ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash)",
    );
  });
});
