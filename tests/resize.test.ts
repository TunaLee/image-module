import { describe, expect, it } from "vitest";

import { resizedDimensions } from "../components/inspection-form";

describe("resizedDimensions", () => {
  it("caps a landscape photo at 640px while preserving its aspect ratio", () => {
    expect(resizedDimensions(1600, 800, 640)).toEqual({ width: 640, height: 320 });
  });

  it("caps a portrait photo at 640px while preserving its aspect ratio", () => {
    expect(resizedDimensions(900, 1200, 640)).toEqual({ width: 480, height: 640 });
  });

  it("does not enlarge an image already within the maximum edge", () => {
    expect(resizedDimensions(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });
});
