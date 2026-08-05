# Equipment Inspection Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a LAN-accessible, authenticated equipment-photo inspection app that saves 640px photos locally, requests NVIDIA OCR and visual inspection, and stores user-owned history in Neon.

**Architecture:** Next.js App Router supplies both the browser UI and server API. Route handlers authenticate an HttpOnly session, write the uploaded image under `public/uploads`, call NVIDIA NIM through isolated adapters, and persist JSON results in Neon. Client components resize selected images before multipart upload and render a mobile-first authenticated dashboard.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Tailwind CSS 4, Neon serverless driver, Zod, Node `crypto`, Sharp, Vitest.

## Global Constraints

- Read `node_modules/next/dist/docs/` for the relevant Next.js 16 route-handler, App Router, and server/client component guides before writing application code; this project is not compatible with older Next.js conventions.
- Keep `NVIDIA_API_KEY`, `DATABASE_URL`, and `SESSION_SECRET` server-only; do not prefix them with `NEXT_PUBLIC_` or send them to the client.
- Resize each selected photo in the browser so its longest edge is exactly 640 pixels before upload; use JPEG output and preserve aspect ratio.
- Store each accepted upload beneath `public/uploads` using a UUID filename; persist the browser-visible relative path in Neon.
- Set the camera input attributes to `accept="image/*"` and `capture="environment"`.
- Restrict every inspection list and detail read to the authenticated owner user ID.
- Store only structured OCR and visual results matching the types defined in Task 1.
- Use `npm run dev -- --hostname 0.0.0.0` for same-Wi-Fi development; do not expose the app to the public internet as part of this release.

---

## File Structure

- `lib/types.ts`: Shared inspection modes, stored result types, and API result shapes.
- `lib/env.ts`: Server-only environment validation.
- `lib/db.ts`: Neon connection and SQL schema initializer.
- `lib/auth.ts`: Password hashing, session creation, cookie parsing, and current-user lookup.
- `lib/nvidia.ts`: Server-only NVIDIA NIM request adapters and strict JSON parsing.
- `lib/image.ts`: Server-side upload validation and UUID file write.
- `lib/inspection.ts`: Orchestrates model calls and creates user-owned inspections.
- `app/api/auth/register/route.ts`, `login/route.ts`, `logout/route.ts`: Authentication endpoints.
- `app/api/inspections/route.ts`: Authenticated create and latest-six endpoints.
- `app/api/inspections/[id]/route.ts`: Authenticated detail endpoint.
- `components/auth-form.tsx`: Reusable registration/login form.
- `components/inspection-form.tsx`: Image resizing, preview, mode selection, and submit UI.
- `components/inspection-list.tsx`: Latest-six cards and fetch state.
- `components/inspection-detail.tsx`: Structured result renderer.
- `app/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx`, `app/inspections/[id]/page.tsx`: Route-level screens.
- `app/globals.css`: Mobile-first visual system.
- `tests/*.test.ts`: Isolated unit and route-handler tests.

### Task 1: Establish dependencies, types, environment validation, and test runner

**Files:**
- Modify: `package.json`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Create: `lib/types.ts`
- Create: `lib/env.ts`
- Create: `tests/env.test.ts`

**Interfaces:**
- Produces `InspectionMode`, `OcrResult`, `VisualResult`, and `InspectionRecord` from `lib/types.ts`.
- Produces `getServerEnv(): { DATABASE_URL: string; NVIDIA_API_KEY: string; SESSION_SECRET: string }` from `lib/env.ts`.

- [ ] **Step 1: Install runtime and test dependencies**

Run: `npm install @neondatabase/serverless sharp zod && npm install -D vitest`

- [ ] **Step 2: Write the failing environment test**

```ts
// tests/env.test.ts
import { describe, expect, it } from "vitest";
import { getServerEnv } from "../lib/env";

describe("getServerEnv", () => {
  it("rejects an absent NVIDIA key", () => {
    expect(() => getServerEnv({ DATABASE_URL: "postgres://db", SESSION_SECRET: "x" }))
      .toThrow("NVIDIA_API_KEY");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/env.test.ts`

Expected: FAIL because `lib/env.ts` does not exist.

- [ ] **Step 4: Implement types, environment parsing, and Vitest configuration**

```ts
// lib/types.ts
export type InspectionMode = "ocr" | "visual" | "both";
export type OcrResult = { equipmentNameOrId: string | null; observedAt: string | null; readings: { label: string; value: string; unit: string | null }[]; statusMessages: string[]; otherText: string[]; confidence: number | null };
export type VisualResult = { verdict: "normal" | "abnormal" | "indeterminate"; summary: string; findings: { locationDescription: string; severity: "low" | "medium" | "high"; evidence: string }[]; criteriaAssessment: string; confidence: number | null };
export type InspectionRecord = { id: string; imagePath: string; mode: InspectionMode; criterion: string | null; ocrResult: OcrResult | null; visualResult: VisualResult | null; status: "completed" | "partial" | "failed"; errorMessage: string | null; createdAt: string };
```

```ts
// lib/env.ts
import "server-only";
import { z } from "zod";
const schema = z.object({ DATABASE_URL: z.string().min(1), NVIDIA_API_KEY: z.string().min(1), SESSION_SECRET: z.string().min(32) });
export function getServerEnv(source = process.env) { return schema.parse(source); }
```

Add scripts `"test": "vitest run"` and `"test:watch": "vitest"`. Set `vitest.config.ts` to `{ test: { environment: "node", include: ["tests/**/*.test.ts"] } }`. Put the three variable names with empty values in `.env.example`.

- [ ] **Step 5: Run focused and static checks**

Run: `npm test -- --run tests/env.test.ts && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 6: Commit the foundation**

Run: `git add package.json package-lock.json .env.example vitest.config.ts lib/types.ts lib/env.ts tests/env.test.ts && git commit -m "chore: add inspection app foundation"`

### Task 2: Create Neon schema and secure session primitives

**Files:**
- Create: `lib/db.ts`
- Create: `lib/auth.ts`
- Create: `tests/auth.test.ts`

**Interfaces:**
- Consumes `getServerEnv` from `lib/env.ts`.
- Produces `initializeSchema()`, `createUser(email, passwordHash)`, `findUserByEmail(email)`, `insertSession(userId)`, `findSessionUser(token)`, and `deleteSession(token)`.
- Produces `hashPassword(password)`, `verifyPassword(password, storedHash)`, `createSession(userId)`, `getCurrentUser()`, and `clearSession()`.

- [ ] **Step 1: Write failing password and session-token tests**

```ts
// tests/auth.test.ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, hashSessionToken } from "../lib/auth";

describe("credentials", () => {
  it("verifies the correct password only", async () => {
    const stored = await hashPassword("long-enough-password");
    await expect(verifyPassword("long-enough-password", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
  });
  it("does not retain a raw session token", () => {
    expect(hashSessionToken("session-token")).not.toBe("session-token");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`

Expected: FAIL because `lib/auth.ts` does not exist.

- [ ] **Step 3: Implement schema and session helpers**

Use Neon tagged SQL in `lib/db.ts`; create `users`, `sessions`, and `inspections` with UUID primary keys, foreign keys to `users`, JSONB result columns, and an index on `(user_id, created_at desc)`. In `lib/auth.ts`, use `crypto.scrypt` with a random 16-byte salt for passwords and `crypto.createHash("sha256")` for session tokens. Store a random 32-byte base64url token in an HttpOnly, SameSite Lax cookie named `inspection_session`; store only its SHA-256 hash with a 7-day expiry. Set `secure: process.env.NODE_ENV === "production"` so local HTTP LAN development works.

- [ ] **Step 4: Run focused tests and lint**

Run: `npx vitest run tests/auth.test.ts && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 5: Commit authentication primitives**

Run: `git add lib/db.ts lib/auth.ts tests/auth.test.ts && git commit -m "feat: add Neon sessions and credentials"`

### Task 3: Add registration, login, logout, and session-status endpoints

**Files:**
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `tests/auth-routes.test.ts`

**Interfaces:**
- Consumes `createUser`, `findUserByEmail`, and auth helpers from Task 2.
- Produces `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/session`.

- [ ] **Step 1: Write failing route tests**

```ts
// tests/auth-routes.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/auth", () => ({ register: vi.fn(), login: vi.fn(), clearSession: vi.fn(), getCurrentUser: vi.fn() }));
import { POST as register } from "../app/api/auth/register/route";

describe("POST /api/auth/register", () => {
  it("rejects a short password", async () => {
    const response = await register(new Request("http://localhost/api/auth/register", { method: "POST", body: JSON.stringify({ email: "a@b.com", password: "short" }) }));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npx vitest run tests/auth-routes.test.ts`

Expected: FAIL because the register route is absent.

- [ ] **Step 3: Implement endpoint validation and responses**

Each POST parses `{ email, password }` with `z.object({ email: z.string().email(), password: z.string().min(12).max(128) })`, normalizes the email to lowercase, and returns JSON. Registration returns 201 after creating a session; duplicate email returns 409. Login returns 401 with `{ error: "Invalid email or password" }` for either unknown email or bad password. Logout clears the cookie and deletes its database session. Session returns `{ user: { id, email } }` or 401.

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run tests/auth-routes.test.ts && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 5: Commit authentication routes**

Run: `git add app/api/auth tests/auth-routes.test.ts && git commit -m "feat: add authentication API routes"`

### Task 4: Implement image persistence and NVIDIA model adapters

**Files:**
- Create: `lib/image.ts`
- Create: `lib/nvidia.ts`
- Create: `tests/image.test.ts`
- Create: `tests/nvidia.test.ts`

**Interfaces:**
- Consumes `OcrResult` and `VisualResult` from Task 1 and `getServerEnv` from Task 1.
- Produces `saveUpload(file: File): Promise<{ imagePath: string; base64: string }>`.
- Produces `runOcr(imageBase64: string): Promise<OcrResult>` and `runVisualInspection(imageBase64: string, criterion: string): Promise<VisualResult>`.

- [ ] **Step 1: Write failing image and response-parsing tests**

```ts
// tests/nvidia.test.ts
import { describe, expect, it } from "vitest";
import { parseVisualResult } from "../lib/nvidia";
it("rejects a visual response with an unknown verdict", () => {
  expect(() => parseVisualResult('{"verdict":"maybe"}')).toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/image.test.ts tests/nvidia.test.ts`

Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement upload validation and adapters**

Accept only JPEG, PNG, and WebP under 10 MB. Convert the received `File` to a buffer, use Sharp to re-encode every accepted input as JPEG, generate `randomUUID() + ".jpg"`, ensure `public/uploads` exists, and write the JPEG bytes with `fs/promises`; return `/uploads/<uuid>.jpg` and the JPEG base64 data. Use Zod schemas to parse JSON-only model output. Call the NVIDIA endpoint `https://integrate.api.nvidia.com/v1/chat/completions` using the bearer key, `nvidia/nemotron-ocr-v2` for OCR and `nvidia/nemotron-nano-12b-v2-vl` for visual inspection. Send the JPEG as a data URL in the image content part. OCR prompt requests the exact Task 1 OCR shape; visual prompt includes the criterion and requests the exact Task 1 visual shape. Throw a sanitized `ModelRequestError` for non-2xx or invalid responses.

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run tests/image.test.ts tests/nvidia.test.ts && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 5: Commit media and NVIDIA integration**

Run: `git add lib/image.ts lib/nvidia.ts tests/image.test.ts tests/nvidia.test.ts && git commit -m "feat: add image storage and NVIDIA adapters"`

### Task 5: Create authenticated inspection orchestration and API routes

**Files:**
- Create: `lib/inspection.ts`
- Create: `app/api/inspections/route.ts`
- Create: `app/api/inspections/[id]/route.ts`
- Create: `tests/inspection-routes.test.ts`

**Interfaces:**
- Consumes `saveUpload`, `runOcr`, `runVisualInspection`, `getCurrentUser`, and Task 1 types.
- Produces `createInspection(userId, input): Promise<InspectionRecord>`, `listRecentInspections(userId): Promise<InspectionRecord[]>`, and `getInspection(userId, id): Promise<InspectionRecord | null>`.
- Produces `POST /api/inspections`, `GET /api/inspections`, and `GET /api/inspections/:id`.

- [ ] **Step 1: Write failing ownership and partial-result tests**

```ts
// tests/inspection-routes.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/inspection", () => ({ getInspection: vi.fn() }));
import { GET } from "../app/api/inspections/[id]/route";

it("returns 404 when the inspection is not owned by the user", async () => {
  const response = await GET(new Request("http://localhost/api/inspections/x"), { params: Promise.resolve({ id: "x" }) });
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/inspection-routes.test.ts`

Expected: FAIL because the dynamic route is absent.

- [ ] **Step 3: Implement inspection state transitions**

`POST` requires a current user and multipart fields `image`, `mode`, and optional `criterion`. Reject visual or both mode with blank criterion. Save the upload before calls. For `ocr` call only OCR; for `visual` call only visual; for `both` execute the calls concurrently with `Promise.allSettled`. Persist `completed` when all selected calls succeed, `partial` when one succeeds, and `failed` when none succeed. Limit list SQL to six rows with `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6`; detail SQL includes both `id` and `user_id` and returns 404 when no row exists.

- [ ] **Step 4: Run route tests and lint**

Run: `npx vitest run tests/inspection-routes.test.ts && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 5: Commit inspection API**

Run: `git add lib/inspection.ts app/api/inspections tests/inspection-routes.test.ts && git commit -m "feat: add user-scoped inspection API"`

### Task 6: Build authentication screens and inspection dashboard

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Create: `app/login/page.tsx`
- Create: `app/register/page.tsx`
- Create: `app/inspections/[id]/page.tsx`
- Create: `components/auth-form.tsx`
- Create: `components/inspection-form.tsx`
- Create: `components/inspection-list.tsx`
- Create: `components/inspection-detail.tsx`
- Create: `tests/resize.test.ts`

**Interfaces:**
- Consumes Task 1 types and Task 3/5 API response shapes.
- Produces `resizeImage(file, maxEdge = 640): Promise<File>` from `components/inspection-form.tsx` and UI routes that call the completed APIs.

- [ ] **Step 1: Write the failing resize-rule test**

```ts
// tests/resize.test.ts
import { describe, expect, it } from "vitest";
import { resizedDimensions } from "../components/inspection-form";
it("caps a landscape photo at 640px", () => {
  expect(resizedDimensions(1600, 800, 640)).toEqual({ width: 640, height: 320 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/resize.test.ts`

Expected: FAIL because the inspection form is absent.

- [ ] **Step 3: Implement mobile-first screens and client behavior**

Use a client component for forms and `fetch` calls. `inspection-form.tsx` must use canvas to create a JPEG whose longest edge is 640, expose the pure `resizedDimensions` helper, preview the result with an object URL, and append the resized file to `FormData`. Render an input with `type="file"`, `accept="image/*"`, and `capture="environment"`; render OCR, visual, and both mode controls; disable submission while pending. Render status-specific feedback for completed, partial, and failed records. The dashboard fetches `/api/auth/session` and `/api/inspections`, redirects unauthenticated users to `/login`, and limits display to API-provided six cards. The detail page fetches a single record and displays all structured fields without using `dangerouslySetInnerHTML`.

- [ ] **Step 4: Run client helper test, lint, and production build**

Run: `npx vitest run tests/resize.test.ts && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 5: Commit the user interface**

Run: `git add app components tests/resize.test.ts && git commit -m "feat: add inspection dashboard UI"`

### Task 7: Document LAN setup and execute end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes all completed API and UI routes.
- Produces an operator-ready README and `dev:lan` script.

- [ ] **Step 1: Write the expected operator workflow in README before editing code**

Add a concise checklist: copy `.env.example` to `.env.local`, fill all three values, run the Neon schema initialization path, start `npm run dev:lan`, find the PC LAN IPv4 address, and open `http://<LAN-IP>:3000` from the phone. State that Windows Firewall must permit the port.

- [ ] **Step 2: Add the LAN command and ignore runtime uploads**

Add `"dev:lan": "next dev --hostname 0.0.0.0"` to `package.json`. Add `/public/uploads/` to `.gitignore`, then create `public/uploads/.gitkeep` so the runtime directory exists in fresh clones. Explain that these files are statically served and LAN-only in this release.

- [ ] **Step 3: Run full automated verification**

Run: `npm test && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 4: Perform the manual LAN smoke test**

Run: `npm run dev:lan`

From a same-Wi-Fi phone: register a new account, open camera capture, select a photo, run each mode with test credentials, refresh the dashboard, verify the newest card, open the detail route, and confirm a second account cannot retrieve the first account's record through its detail URL.

- [ ] **Step 5: Commit deployment guidance**

Run: `git add README.md package.json package-lock.json .gitignore public/uploads/.gitkeep && git commit -m "docs: add LAN deployment guide"`

## Plan Self-Review

- Spec coverage: Tasks 1-5 cover server-only secrets, Neon persistence, authentication, public UUID uploads, both NVIDIA model paths, structured results, partial failures, and owner-only queries. Task 6 covers mobile capture, 640px client resize, six-card history, and detail rendering. Task 7 covers LAN startup and manual verification.
- Placeholder scan: no TBD/TODO markers, undefined task references, or generic testing instructions remain.
- Type consistency: `InspectionMode`, `OcrResult`, `VisualResult`, `InspectionRecord`, and the inspection service signatures are defined in Task 1 or Task 5 before their consumers.
