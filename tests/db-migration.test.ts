import { beforeEach, describe, expect, it, vi } from "vitest";

const { sql, transaction, transactionSql } = vi.hoisted(() => {
  const transactionSql = vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  );
  const transaction = vi.fn(
    async (
      buildQueries: (
        query: typeof transactionSql,
      ) => { strings: TemplateStringsArray; values: unknown[] }[],
    ) => buildQueries(transactionSql).map(() => []),
  );
  const sql = Object.assign(
    vi.fn(async () => []),
    { transaction },
  );

  return { sql, transaction, transactionSql };
});

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

import { initializeSchema, SchemaMigrationError } from "../lib/db";

describe("initializeSchema", () => {
  beforeEach(() => {
    sql.mockReset();
    sql.mockResolvedValue([]);
    transaction.mockClear();
    transaction.mockImplementation(async (buildQueries) =>
      buildQueries(transactionSql).map(() => []),
    );
    transactionSql.mockClear();
  });

  it("serializes schema changes across server instances", async () => {
    await initializeSchema();

    const statements = transactionSql.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(" ").replace(/\s+/g, " ").trim(),
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(statements[0]).toBe(
      "SELECT pg_advisory_xact_lock(803522992, 1)",
    );
    expect(
      statements.findIndex((statement) =>
        statement.startsWith("ALTER TABLE users DROP CONSTRAINT"),
      ),
    ).toBeGreaterThan(0);
    expect(
      statements.findIndex((statement) =>
        statement.startsWith("ALTER TABLE sessions DROP CONSTRAINT"),
      ),
    ).toBeGreaterThan(0);
  });

  it("reports a legacy case-insensitive email collision before changing data", async () => {
    transaction.mockImplementation(async (buildQueries) => {
      buildQueries(transactionSql);
      throw new Error(
        "EQUIPMENT_INSPECTION_EMAIL_COLLISION:operator@example.com",
      );
    });

    await expect(initializeSchema()).rejects.toThrow(SchemaMigrationError);
    await expect(initializeSchema()).rejects.toThrow("operator@example.com");
  });

  it("migrates legacy sessions to a UUID primary key and unique token hash", async () => {
    await initializeSchema();

    const statements = transactionSql.mock.calls.map(([strings]) =>
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
