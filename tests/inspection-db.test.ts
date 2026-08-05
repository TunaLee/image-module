import { describe, expect, it, vi } from "vitest";

const { sql } = vi.hoisted(() => {
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
    vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      void strings;
      void values;
      return [];
    }),
    { transaction },
  );

  return { sql };
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

import { findInspectionByIdForUser, listRecentInspectionRecords } from "../lib/db";

function normalizedSql(strings: TemplateStringsArray): string {
  return strings.join(" ? ").replace(/\s+/g, " ").trim();
}

describe("inspection database ownership", () => {
  it("limits recent rows to six records belonging to the requested user", async () => {
    await listRecentInspectionRecords("user-a");

    const query = sql.mock.calls.find(([strings]) =>
      normalizedSql(strings).startsWith("SELECT id, image_path, mode"),
    );

    expect(query).toBeDefined();
    expect(normalizedSql(query![0])).toContain(
      "FROM inspections WHERE user_id = ? ORDER BY created_at DESC LIMIT 6",
    );
    expect(query!.slice(1)).toEqual(["user-a"]);
  });

  it("requires both owner and inspection id for detail lookup", async () => {
    await findInspectionByIdForUser("user-a", "inspection-a");

    const query = sql.mock.calls.find(([strings]) =>
      normalizedSql(strings).includes("WHERE id = ? AND user_id = ?"),
    );

    expect(query).toBeDefined();
    expect(query!.slice(1)).toEqual(["inspection-a", "user-a"]);
  });
});
