import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

const db = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  findSessionUser: vi.fn(),
  insertSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock("../lib/db", () => db);

import { clearSession } from "../lib/auth";

describe("clearSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cookieStore.get.mockReturnValue({ value: "current-session-token" });
  });

  it("clears the browser session even when database token revocation fails", async () => {
    db.deleteSession.mockRejectedValue(new Error("database unavailable"));

    await expect(clearSession()).resolves.toBeUndefined();

    expect(cookieStore.delete).toHaveBeenCalledWith("inspection_session");
  });
});
