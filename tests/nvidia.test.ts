import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelRequestError,
  parseOcrResult,
  parseVisualResult,
  runOcr,
  runVisualInspection,
} from "../lib/nvidia";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("structured NVIDIA results", () => {
  it("rejects a visual response with an unknown verdict", () => {
    expect(() => parseVisualResult('{"verdict":"maybe"}')).toThrow();
  });

  it("rejects OCR responses that omit required provider fields", () => {
    expect(() => parseOcrResult({ data: [{ index: 0 }] }, 640, 480)).toThrow();
  });
});

describe("runOcr", () => {
  it("uses the dedicated OCR API and converts normalized points to image pixels", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "nvidia/nemotron-ocr-v2",
          data: [
            {
              index: 0,
              text_detections: [
                {
                  text_prediction: { text: "Pump A-1", confidence: 0.9 },
                  bounding_box: {
                    points: [
                      { x: 0.25, y: 0.1 },
                      { x: 0.75, y: 0.1 },
                      { x: 0.75, y: 0.2 },
                      { x: 0.25, y: 0.2 },
                    ],
                  },
                },
              ],
            },
          ],
          usage: { images_size_mb: 0.01 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOcr("jpeg-data", 640, 480)).resolves.toEqual({
      imageWidth: 640,
      imageHeight: 480,
      textDetections: [
        {
          text: "Pump A-1",
          confidence: 0.9,
          boundingBox: {
            points: [
              { x: 160, y: 48 },
              { x: 480, y: 48 },
              { x: 480, y: 96 },
              { x: 160, y: 96 },
            ],
          },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer nvidia-secret" }),
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toEqual({
      input: [
        {
          type: "image_url",
          url: "data:image/jpeg;base64,jpeg-data",
        },
      ],
    });
  });

  it("does not expose invalid provider response details", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider details", { status: 500 })));

    await expect(runOcr("jpeg-data", 640, 480)).rejects.toEqual(
      expect.objectContaining({
        name: ModelRequestError.name,
        message: "NVIDIA model request failed.",
      }),
    );
  });
});

describe("runVisualInspection", () => {
  it("sends the visual model the supplied criterion as reference data", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "normal",
                  summary: "No visible defect",
                  findings: [],
                  criteriaAssessment: "Meets the criterion",
                  confidence: 0.85,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runVisualInspection("jpeg-data", "No corrosion")).resolves.toMatchObject({
      verdict: "normal",
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("nvidia/nemotron-nano-12b-v2-vl");
    expect(request.messages[0].content).toEqual([
      expect.objectContaining({ type: "text" }),
      {
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,jpeg-data" },
      },
    ]);
    expect(request.messages[0].content[0].text).toContain('"No corrosion"');
  });
});
