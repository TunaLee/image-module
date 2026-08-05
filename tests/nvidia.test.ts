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

  it("rejects OCR responses that omit required structured fields", () => {
    expect(() => parseOcrResult('{"equipmentNameOrId":"Boiler 1"}')).toThrow();
  });
});

describe("runOcr", () => {
  it("sends a server-authenticated OCR request with a JPEG data URL", async () => {
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
                  equipmentNameOrId: "Pump A-1",
                  observedAt: null,
                  readings: [],
                  statusMessages: [],
                  otherText: [],
                  confidence: 0.9,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOcr("jpeg-data")).resolves.toMatchObject({
      equipmentNameOrId: "Pump A-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer nvidia-secret" }),
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("nvidia/nemotron-ocr-v2");
    expect(request).not.toHaveProperty("response_format");
    expect(request.messages[0].content).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,jpeg-data" },
    });
  });

  it("does not expose invalid provider response details", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("provider details", { status: 500 })));

    await expect(runOcr("jpeg-data")).rejects.toEqual(
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
    expect(request.messages[0].content[0].text).toContain('"No corrosion"');
  });
});
