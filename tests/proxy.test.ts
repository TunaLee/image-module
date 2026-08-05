import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "../proxy";

const allowedOrigin = "http://192.168.0.34:3000";

describe("API CORS proxy", () => {
  it("answers preflight requests for the internal origin with credentialed CORS headers", async () => {
    const response = proxy(
      new NextRequest("http://192.168.123.20:3000/api/inspections", {
        method: "OPTIONS",
        headers: {
          origin: allowedOrigin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("rejects preflight requests from every other origin", async () => {
    const response = proxy(
      new NextRequest("http://192.168.123.20:3000/api/inspections", {
        method: "OPTIONS",
        headers: { origin: "http://192.168.123.11" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("adds the exact origin, never a wildcard, to allowed API responses", () => {
    const response = proxy(
      new NextRequest("http://192.168.123.20:3000/api/auth/session", {
        headers: { origin: allowedOrigin },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("allows the local development origin", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("rejects a simple API request from a disallowed origin", () => {
    const response = proxy(
      new NextRequest("http://192.168.123.20:3000/api/auth/session", {
        headers: { origin: "https://example.com" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("continues same-origin and non-browser requests without an Origin header", () => {
    const response = proxy(
      new NextRequest("http://192.168.123.20:3000/api/auth/session"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
