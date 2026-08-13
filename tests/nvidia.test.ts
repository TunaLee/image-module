import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelRequestError,
  parseOcrResult,
  parseVisualResult,
  runOcr,
  runVisualInspection,
} from "../lib/nvidia";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("structured NVIDIA results", () => {
  it("parses a visual JSON object wrapped in the model's prose and code fence", () => {
    expect(
      parseVisualResult(
        'Assessment follows.\n```json\n{"verdict":"indeterminate","summary":"Possible burn mark","findings":[],"criteriaAssessment":"Needs review","confidence":null}\n```\nPlease review.',
      ),
    ).toMatchObject({ verdict: "indeterminate", summary: "Possible burn mark" });
  });

  it("rejects a visual response with an unknown verdict", () => {
    expect(() => parseVisualResult('{"verdict":"maybe"}')).toThrow();
  });

  it("rejects OCR responses that omit required provider fields", () => {
    expect(() => parseOcrResult({ data: [{ index: 0 }] }, 640, 480)).toThrow();
  });
});

describe("runOcr", () => {
  it("polls a queued OCR request, preserves pixel detections, and extracts structured equipment data", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ requestId: "ocr-request-1" }), { status: 202 }),
      )
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    equipmentNameOrId: "Pump A-1",
                    observedAt: "2026-08-05 09:30",
                    readings: [{ label: "Pressure", value: "3.2", unit: "bar" }],
                    statusMessages: ["RUN"],
                    otherText: ["Line 2"],
                    confidence: 0.88,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOcr("jpeg-data", 640, 480)).resolves.toEqual({
      imageWidth: 640,
      imageHeight: 480,
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
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://ai.api.nvidia.com/v1/status/ocr-request-1",
    );
    const semanticRequest = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(semanticRequest.model).toBe("nvidia/nemotron-nano-12b-v2-vl");
    expect(semanticRequest.messages[0].content[0].text).toContain("Pump A-1");
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

  it("polls the integrate status endpoint when the visual request is queued", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { "NVCF-REQID": "visual-request-1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "abnormal",
                    summary: "Leak found",
                    findings: [
                      {
                        locationDescription: "lower valve",
                        severity: "high",
                        evidence: "visible fluid",
                      },
                    ],
                    criteriaAssessment: "Does not meet the criterion",
                    confidence: 0.91,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(runVisualInspection("jpeg-data", "No leaks")).resolves.toMatchObject({
      verdict: "abnormal",
      summary: "Leak found",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://integrate.api.nvidia.com/v1/status/visual-request-1",
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer nvidia-secret" }),
      }),
    );
  });

  it("stops polling and reports a safe timeout when a queued request never completes", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DATABASE_URL", "postgres://db");
    vi.stubEnv("NVIDIA_API_KEY", "nvidia-secret");
    vi.stubEnv("SESSION_SECRET", "x".repeat(32));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "NVCF-REQID": "visual-request-timeout" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = expect(runVisualInspection("jpeg-data", "No leaks")).rejects.toEqual(
      expect.objectContaining({
        name: ModelRequestError.name,
        message: "NVIDIA model request timed out.",
      }),
    );
    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(61);
  });
});
