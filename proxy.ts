import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://192.168.0.34:3000",
]);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin",
} as const;

function addCorsHeaders(response: NextResponse, origin: string): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", origin);
  for (const [name, value] of Object.entries(corsHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const isAllowedOrigin = origin !== null && ALLOWED_ORIGINS.has(origin);

  if (origin && !isAllowedOrigin) {
    return new NextResponse(null, { status: 403 });
  }

  if (request.method === "OPTIONS") {
    if (!origin) {
      return new NextResponse(null, { status: 403 });
    }

    return addCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  const response = NextResponse.next();
  return isAllowedOrigin ? addCorsHeaders(response, origin) : response;
}

export const config = {
  matcher: "/api/:path*",
};
