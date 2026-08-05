import { describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({
  PrismaPg: vi.fn(function PrismaPg() {
    return { transport: "pg" };
  }),
}));

const clients = vi.hoisted(() => ({
  PrismaClient: vi.fn(function PrismaClient(options: unknown) {
    return { options };
  }),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: adapters.PrismaPg,
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: clients.PrismaClient,
}));

vi.mock("../lib/env", () => ({
  getServerEnv: () => ({ DATABASE_URL: "postgres://runtime-neon" }),
}));

import { getPrisma } from "../lib/prisma";

describe("Prisma PostgreSQL client", () => {
  it("uses the PostgreSQL adapter for the local runtime database", () => {
    getPrisma();

    expect(adapters.PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgres://runtime-neon",
    });
    expect(clients.PrismaClient).toHaveBeenCalledWith({
      adapter: expect.objectContaining({ transport: "pg" }),
    });
  });
});
