import { describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({
  http: { transport: "http" },
  PrismaNeon: vi.fn(function PrismaNeon() {
    return { transport: "websocket" };
  }),
  PrismaNeonHttp: vi.fn(function PrismaNeonHttp() {
    return { transport: "http" };
  }),
}));

const clients = vi.hoisted(() => ({
  PrismaClient: vi.fn(function PrismaClient(options: unknown) {
    return { options };
  }),
}));

vi.mock("@prisma/adapter-neon", () => ({
  PrismaNeon: adapters.PrismaNeon,
  PrismaNeonHttp: adapters.PrismaNeonHttp,
}));

vi.mock("../generated/prisma/client", () => ({
  PrismaClient: clients.PrismaClient,
}));

vi.mock("../lib/env", () => ({
  getServerEnv: () => ({ DATABASE_URL: "postgres://runtime-neon" }),
}));

import { getPrisma } from "../lib/prisma";

describe("Prisma Neon client", () => {
  it("uses the HTTP adapter so the supported Node 20 runtime needs no WebSocket polyfill", () => {
    getPrisma();

    expect(adapters.PrismaNeonHttp).toHaveBeenCalledWith(
      "postgres://runtime-neon",
      {},
    );
    expect(adapters.PrismaNeon).not.toHaveBeenCalled();
    expect(clients.PrismaClient).toHaveBeenCalledWith({
      adapter: expect.objectContaining({ transport: "http" }),
    });
  });
});
