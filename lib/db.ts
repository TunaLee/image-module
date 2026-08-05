import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "../generated/prisma/client";
import { getPrisma } from "./prisma";
import type { InspectionRecord, OcrResult, VisualResult } from "./types";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
};

export type SessionUser = Pick<User, "id" | "email">;

export type NewInspectionRecord = Omit<InspectionRecord, "id" | "createdAt">;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const userSelect = {
  id: true,
  email: true,
  passwordHash: true,
} as const;

const inspectionSelect = {
  id: true,
  imagePath: true,
  mode: true,
  criterion: true,
  ocrResult: true,
  visualResult: true,
  status: true,
  errorMessage: true,
  createdAt: true,
} as const;

type InspectionRow = {
  id: string;
  imagePath: string;
  mode: string;
  criterion: string | null;
  ocrResult: Prisma.JsonValue | null;
  visualResult: Prisma.JsonValue | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
};

function toInspectionRecord(row: InspectionRow): InspectionRecord {
  return {
    id: row.id,
    imagePath: row.imagePath,
    mode: row.mode as InspectionRecord["mode"],
    criterion: row.criterion,
    ocrResult: row.ocrResult as OcrResult | null,
    visualResult: row.visualResult as VisualResult | null,
    status: row.status as InspectionRecord["status"],
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  return getPrisma().user.create({
    data: {
      id: randomUUID(),
      email: normalizeEmail(email),
      passwordHash,
    },
    select: userSelect,
  });
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return getPrisma().user.findUnique({
    where: { email: normalizeEmail(email) },
    select: userSelect,
  });
}

export async function insertSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await getPrisma().session.create({
    data: {
      id: randomUUID(),
      tokenHash,
      userId,
      expiresAt,
    },
  });
}

export async function findSessionUser(tokenHash: string): Promise<SessionUser | null> {
  const session = await getPrisma().session.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
    },
    select: {
      user: {
        select: { id: true, email: true },
      },
    },
  });

  return session?.user ?? null;
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await getPrisma().session.deleteMany({
    where: { tokenHash },
  });
}

export async function createInspectionRecord(
  userId: string,
  record: NewInspectionRecord,
): Promise<InspectionRecord> {
  const saved = await getPrisma().inspection.create({
    data: {
      id: randomUUID(),
      userId,
      imagePath: record.imagePath,
      mode: record.mode,
      criterion: record.criterion,
      ocrResult:
        record.ocrResult === null
          ? Prisma.DbNull
          : (record.ocrResult as Prisma.InputJsonValue),
      visualResult:
        record.visualResult === null
          ? Prisma.DbNull
          : (record.visualResult as Prisma.InputJsonValue),
      status: record.status,
      errorMessage: record.errorMessage,
    },
    select: inspectionSelect,
  });

  return toInspectionRecord(saved);
}

export async function listRecentInspectionRecords(userId: string): Promise<InspectionRecord[]> {
  const rows = await getPrisma().inspection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: inspectionSelect,
  });

  return rows.map(toInspectionRecord);
}

export async function findInspectionByIdForUser(
  userId: string,
  inspectionId: string,
): Promise<InspectionRecord | null> {
  const row = await getPrisma().inspection.findFirst({
    where: { id: inspectionId, userId },
    select: inspectionSelect,
  });

  return row ? toInspectionRecord(row) : null;
}
