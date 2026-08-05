import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  user: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  session: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
  inspection: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("../lib/prisma", () => ({ getPrisma: () => prisma }));

import {
  createInspectionRecord,
  createUser,
  deleteSession,
  findInspectionByIdForUser,
  findSessionUser,
  findUserByEmail,
  insertSession,
  listRecentInspectionRecords,
} from "../lib/db";

const createdAt = new Date("2026-08-05T03:00:00.000Z");

describe("Prisma database access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("normalizes user emails before a typed unique lookup", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await findUserByEmail("  Operator@Example.COM ");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "operator@example.com" },
      select: { id: true, email: true, passwordHash: true },
    });
  });

  it("creates UUID-backed users through Prisma", async () => {
    prisma.user.create.mockResolvedValue({
      id: "17b4b70b-5be6-421f-bc1f-9bcd5c6dfd3b",
      email: "operator@example.com",
      passwordHash: "hashed",
    });

    const user = await createUser("Operator@Example.COM", "hashed");

    expect(user.email).toBe("operator@example.com");
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        email: "operator@example.com",
        passwordHash: "hashed",
      },
      select: { id: true, email: true, passwordHash: true },
    });
  });

  it("stores and resolves only unexpired hashed sessions", async () => {
    const expiresAt = new Date("2026-08-12T03:00:00.000Z");
    prisma.session.create.mockResolvedValue({});
    prisma.session.findFirst.mockResolvedValue({
      user: { id: "user-a", email: "operator@example.com" },
    });

    await insertSession("user-a", "token-hash", expiresAt);
    const user = await findSessionUser("token-hash");

    expect(prisma.session.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        userId: "user-a",
        tokenHash: "token-hash",
        expiresAt,
      },
    });
    expect(prisma.session.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: "token-hash",
        expiresAt: { gt: expect.any(Date) },
      },
      select: { user: { select: { id: true, email: true } } },
    });
    expect(user).toEqual({ id: "user-a", email: "operator@example.com" });

    await deleteSession("token-hash");
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: "token-hash" },
    });
  });

  it("limits inspection lists and detail reads by owner", async () => {
    prisma.inspection.findMany.mockResolvedValue([]);
    prisma.inspection.findFirst.mockResolvedValue(null);

    await listRecentInspectionRecords("user-a");
    await findInspectionByIdForUser("user-a", "inspection-a");

    expect(prisma.inspection.findMany).toHaveBeenCalledWith({
      where: { userId: "user-a" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: expect.objectContaining({ id: true, imagePath: true, createdAt: true }),
    });
    expect(prisma.inspection.findFirst).toHaveBeenCalledWith({
      where: { id: "inspection-a", userId: "user-a" },
      select: expect.objectContaining({ id: true, imagePath: true, createdAt: true }),
    });
  });

  it("maps Prisma inspection dates and JSON fields to the API record", async () => {
    prisma.inspection.create.mockResolvedValue({
      id: "inspection-a",
      imagePath: "/uploads/a.jpg",
      mode: "ocr",
      criterion: null,
      ocrResult: { confidence: 0.9 },
      visualResult: null,
      status: "completed",
      errorMessage: null,
      createdAt,
    });

    const saved = await createInspectionRecord("user-a", {
      imagePath: "/uploads/a.jpg",
      mode: "ocr",
      criterion: null,
      ocrResult: { confidence: 0.9 } as never,
      visualResult: null,
      status: "completed",
      errorMessage: null,
    });

    expect(prisma.inspection.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        userId: "user-a",
        imagePath: "/uploads/a.jpg",
        mode: "ocr",
        criterion: null,
        ocrResult: { confidence: 0.9 },
        visualResult: expect.anything(),
        status: "completed",
        errorMessage: null,
      },
      select: expect.objectContaining({ id: true, imagePath: true, createdAt: true }),
    });
    expect(saved.createdAt).toBe("2026-08-05T03:00:00.000Z");
  });
});
