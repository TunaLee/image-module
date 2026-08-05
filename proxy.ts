import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ALLOWED_ORIGIN = "http://192.168.0.34";

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin",
} as const;

function addCorsHeaders(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  for (const [name, value] of Object.entries(corsHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const isAllowedOrigin = origin === ALLOWED_ORIGIN;

  if (origin && !isAllowedOrigin) {
    return new NextResponse(null, { status: 403 });
  }

  if (request.method === "OPTIONS") {
    if (!origin) {
      return new NextResponse(null, { status: 403 });
    }

    return addCorsHeaders(new NextResponse(null, { status: 204 }));
  }

  const response = NextResponse.next();
  return isAllowedOrigin ? addCorsHeaders(response) : response;
}

export const config = {
  matcher: "/api/:path*",
};
