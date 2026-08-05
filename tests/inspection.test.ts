import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createInspectionRecord: vi.fn(),
  findInspectionByIdForUser: vi.fn(),
  listRecentInspectionRecords: vi.fn(),
}));
const image = vi.hoisted(() => ({ saveUpload: vi.fn() }));
const nvidia = vi.hoisted(() => ({ runOcr: vi.fn(), runVisualInspection: vi.fn() }));

vi.mock("../lib/db", () => db);
vi.mock("../lib/image", () => image);
vi.mock("../lib/nvidia", () => nvidia);

import { createInspection } from "../lib/inspection";

describe("createInspection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    image.saveUpload.mockResolvedValue({
      imagePath: "/uploads/photo.jpg",
      base64: "encoded-jpeg",
      width: 640,
      height: 320,
    });
    db.createInspectionRecord.mockImplementation(async (_userId, input) => ({
      id: "a8f488d3-5fba-44a5-a00a-24dd4cbd8c72",
      ...input,
      createdAt: "2026-08-05T00:00:00.000Z",
    }));
  });

  it("persists a partial result when one of the requested models fails", async () => {
    nvidia.runOcr.mockResolvedValue({
      imageWidth: 640,
      imageHeight: 320,
      textDetections: [],
    });
    nvidia.runVisualInspection.mockRejectedValue(new Error("provider outage"));

    const record = await createInspection("user-1", {
      file: new File(["image"], "equipment.jpg", { type: "image/jpeg" }),
      mode: "both",
      criterion: "No visible corrosion",
    });

    expect(record.status).toBe("partial");
    expect(record.ocrResult?.imageWidth).toBe(640);
    expect(record.visualResult).toBeNull();
    expect(record.errorMessage).toBe("Visual inspection could not be completed.");
    expect(db.createInspectionRecord).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        imagePath: "/uploads/photo.jpg",
        mode: "both",
        status: "partial",
      }),
    );
  });

  it("does not call the visual model for an OCR-only inspection", async () => {
    nvidia.runOcr.mockResolvedValue({
      imageWidth: 640,
      imageHeight: 320,
      textDetections: [],
    });

    const record = await createInspection("user-1", {
      file: new File(["image"], "equipment.jpg", { type: "image/jpeg" }),
      mode: "ocr",
      criterion: null,
    });

    expect(record.status).toBe("completed");
    expect(record.visualResult).toBeNull();
    expect(nvidia.runOcr).toHaveBeenCalledWith("encoded-jpeg", 640, 320);
    expect(nvidia.runVisualInspection).not.toHaveBeenCalled();
  });

  it("persists a failed result when every selected model fails", async () => {
    nvidia.runOcr.mockRejectedValue(new Error("ocr provider details"));
    nvidia.runVisualInspection.mockRejectedValue(new Error("visual provider details"));

    const record = await createInspection("user-1", {
      file: new File(["image"], "equipment.jpg", { type: "image/jpeg" }),
      mode: "both",
      criterion: "No visible corrosion",
    });

    expect(record.status).toBe("failed");
    expect(record.ocrResult).toBeNull();
    expect(record.visualResult).toBeNull();
    expect(record.errorMessage).toBe(
      "OCR could not be completed. Visual inspection could not be completed.",
    );
  });

  it("runs only visual inspection for visual mode", async () => {
    nvidia.runVisualInspection.mockResolvedValue({
      verdict: "normal",
      summary: "No anomaly found",
      findings: [],
      criteriaAssessment: "Criterion met",
      confidence: 0.95,
    });

    const record = await createInspection("user-1", {
      file: new File(["image"], "equipment.jpg", { type: "image/jpeg" }),
      mode: "visual",
      criterion: "No visible corrosion",
    });

    expect(record.status).toBe("completed");
    expect(nvidia.runOcr).not.toHaveBeenCalled();
    expect(nvidia.runVisualInspection).toHaveBeenCalledWith(
      "encoded-jpeg",
      "No visible corrosion",
    );
  });

  it("waits for the saved upload before starting both model calls", async () => {
    let finishUpload!: (upload: {
      imagePath: string;
      base64: string;
      width: number;
      height: number;
    }) => void;
    image.saveUpload.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    );
    nvidia.runOcr.mockResolvedValue({
      imageWidth: 640,
      imageHeight: 320,
      textDetections: [],
    });
    nvidia.runVisualInspection.mockResolvedValue({
      verdict: "normal",
      summary: "No anomaly found",
      findings: [],
      criteriaAssessment: "Criterion met",
      confidence: 0.95,
    });

    const pending = createInspection("user-1", {
      file: new File(["image"], "equipment.jpg", { type: "image/jpeg" }),
      mode: "both",
      criterion: "No visible corrosion",
    });
    await Promise.resolve();

    expect(nvidia.runOcr).not.toHaveBeenCalled();
    expect(nvidia.runVisualInspection).not.toHaveBeenCalled();

    finishUpload({
      imagePath: "/uploads/photo.jpg",
      base64: "encoded-jpeg",
      width: 640,
      height: 320,
    });
    await pending;

    expect(nvidia.runOcr).toHaveBeenCalledWith("encoded-jpeg", 640, 320);
    expect(nvidia.runVisualInspection).toHaveBeenCalledWith(
      "encoded-jpeg",
      "No visible corrosion",
    );
  });
});
