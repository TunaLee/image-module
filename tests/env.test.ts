import { describe, expect, it } from "vitest";

import { getServerEnv } from "../lib/env";

describe("getServerEnv", () => {
  it("rejects an absent NVIDIA key", () => {
    expect(() =>
      getServerEnv({ DATABASE_URL: "postgres://db", SESSION_SECRET: "x" }),
    ).toThrow("NVIDIA_API_KEY");
  });
});
