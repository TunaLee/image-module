import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OcrResult } from "../lib/types";

const ocr: OcrResult = {
  imageWidth: 640,
  imageHeight: 320,
  equipmentNameOrId: "Pump A-1",
  observedAt: "2026-08-05 09:30",
  readings: [{ label: "Pressure", value: "3.2", unit: "bar" }],
  statusMessages: ["RUN"],
  otherText: ["Line 2"],
  confidence: 0.88,
  textDetections: [
    {
      text: "Pump A-1",
      confidence: 0.9,
      boundingBox: {
        points: [
          { x: 160, y: 32 },
          { x: 480, y: 32 },
          { x: 480, y: 64 },
          { x: 160, y: 64 },
        ],
      },
    },
  ],
};

describe("inspection OCR detail", () => {
  it("renders the image and OCR overlay in one exact-aspect-ratio box", async () => {
    const detailComponents = await import("../components/inspection-detail");
    const OcrImage = (detailComponents as Record<string, unknown>).OcrImage;

    expect(OcrImage).toBeTypeOf("function");

    const html = renderToStaticMarkup(
      createElement(
        OcrImage as ComponentType<{ imagePath: string; ocr: OcrResult }>,
        { imagePath: "/uploads/landscape.jpg", ocr },
      ),
    );

    expect(html).toContain('style="aspect-ratio:640 / 320;min-height:0"');
    expect(html).toContain('viewBox="0 0 640 320"');
    expect(html).toContain('points="160,32 480,32 480,64 160,64"');
  });

  it("renders the structured OCR fields alongside raw detections", async () => {
    const detailComponents = await import("../components/inspection-detail");
    const OcrResultPanel = (detailComponents as Record<string, unknown>).OcrResultPanel;

    expect(OcrResultPanel).toBeTypeOf("function");

    const html = renderToStaticMarkup(
      createElement(OcrResultPanel as ComponentType<{ ocr: OcrResult }>, { ocr }),
    );

    expect(html).toContain("Pump A-1");
    expect(html).toContain("2026-08-05 09:30");
    expect(html).toContain("Pressure");
    expect(html).toContain("3.2 bar");
    expect(html).toContain("RUN");
    expect(html).toContain("Line 2");
    expect(html).toContain("88%");
    expect(html).toContain("160, 32");
  });

  it("keeps legacy raw-only OCR records viewable", async () => {
    const detailComponents = await import("../components/inspection-detail");
    const OcrResultPanel = (detailComponents as Record<string, unknown>).OcrResultPanel;
    const legacyOcr = {
      imageWidth: 640,
      imageHeight: 320,
      textDetections: ocr.textDetections,
    } as OcrResult;

    expect(() =>
      renderToStaticMarkup(
        createElement(OcrResultPanel as ComponentType<{ ocr: OcrResult }>, {
          ocr: legacyOcr,
        }),
      ),
    ).not.toThrow();
  });
});
