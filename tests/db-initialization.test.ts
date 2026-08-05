import { describe, expect, it, vi } from "vitest";

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

import { findUserByEmail } from "../lib/db";

describe("database helpers", () => {
  it("initializes the schema before querying users", async () => {
    await findUserByEmail("operator@example.com");

    const schemaStatements = transactionSql.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(" ").replace(/\s+/g, " ").trim(),
    );
    const queryStatements = sql.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(" ").replace(/\s+/g, " ").trim(),
    );
    const schemaStatementIndex = schemaStatements.findIndex((statement) =>
      statement.startsWith("CREATE TABLE IF NOT EXISTS users"),
    );
    const userLookupIndex = queryStatements.findIndex((statement) =>
      statement.startsWith("SELECT id, email, password_hash FROM users"),
    );

    expect(schemaStatementIndex).toBeGreaterThanOrEqual(0);
    expect(userLookupIndex).toBeGreaterThanOrEqual(0);
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      sql.mock.invocationCallOrder[0],
    );
  });
});
