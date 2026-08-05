import "server-only";

import {
  createInspectionRecord,
  findInspectionByIdForUser,
  listRecentInspectionRecords,
  type NewInspectionRecord,
} from "./db";
import { saveUpload } from "./image";
import { runOcr, runVisualInspection } from "./nvidia";
import type { InspectionMode, InspectionRecord, OcrResult, VisualResult } from "./types";

export type CreateInspectionInput = {
  file: File;
  mode: InspectionMode;
  criterion: string | null;
};

type ModelOutcomes = {
  ocrResult: OcrResult | null;
  visualResult: VisualResult | null;
  errorMessage: string | null;
};

function errorFor(label: string): string {
  return `${label} could not be completed.`;
}

async function runSelectedModels(
  imageBase64: string,
  imageWidth: number,
  imageHeight: number,
  mode: InspectionMode,
  criterion: string | null,
): Promise<ModelOutcomes> {
  const requests: (
    | { type: "ocr"; request: Promise<OcrResult> }
    | { type: "visual"; request: Promise<VisualResult> }
  )[] = [];

  if (mode === "ocr" || mode === "both") {
    requests.push({
      type: "ocr",
      request: runOcr(imageBase64, imageWidth, imageHeight),
    });
  }
  if (mode === "visual" || mode === "both") {
    requests.push({
      type: "visual",
      request: runVisualInspection(imageBase64, criterion ?? ""),
    });
  }

  const settled = await Promise.allSettled(requests.map(({ request }) => request));
  let ocrResult: OcrResult | null = null;
  let visualResult: VisualResult | null = null;
  const errors: string[] = [];

  for (const [index, outcome] of settled.entries()) {
    const request = requests[index];
    if (!request) continue;

    if (outcome.status === "rejected") {
      errors.push(errorFor(request.type === "ocr" ? "OCR" : "Visual inspection"));
    } else if (request.type === "ocr") {
      ocrResult = outcome.value as OcrResult;
    } else {
      visualResult = outcome.value as VisualResult;
    }
  }

  return {
    ocrResult,
    visualResult,
    errorMessage: errors.length > 0 ? errors.join(" ") : null,
  };
}

export async function createInspection(
  userId: string,
  input: CreateInspectionInput,
): Promise<InspectionRecord> {
  const upload = await saveUpload(input.file);
  const outcomes = await runSelectedModels(
    upload.base64,
    upload.width,
    upload.height,
    input.mode,
    input.criterion,
  );
  const selectedCount = input.mode === "both" ? 2 : 1;
  const successCount = Number(outcomes.ocrResult !== null) + Number(outcomes.visualResult !== null);
  const status: NewInspectionRecord["status"] =
    successCount === selectedCount ? "completed" : successCount > 0 ? "partial" : "failed";

  return createInspectionRecord(userId, {
    imagePath: upload.imagePath,
    mode: input.mode,
    criterion: input.criterion,
    ocrResult: outcomes.ocrResult,
    visualResult: outcomes.visualResult,
    status,
    errorMessage: outcomes.errorMessage,
  });
}

export function listRecentInspections(userId: string): Promise<InspectionRecord[]> {
  return listRecentInspectionRecords(userId);
}

export function getInspection(userId: string, inspectionId: string): Promise<InspectionRecord | null> {
  return findInspectionByIdForUser(userId, inspectionId);
}
