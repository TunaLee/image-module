# MCP Host Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inspection application a server-only NVIDIA agent host and MCP client that can automatically and conversationally execute audited in-app maintenance requests.

**Architecture:** The Next.js server owns LLM orchestration, authorization, Prisma writes, and the private internal tool API. A typed MCP adapter uses Streamable HTTP to call the separately deployed FastMCP server, which calls the internal API using service authentication. All browser access remains through existing session-authenticated routes.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Prisma 7, PostgreSQL/Neon, Zod, Vitest, `@modelcontextprotocol/client`, NVIDIA Nemotron API.

## Global Constraints

- Start only after the multimodal trend-agent branch has its two final blocking defects repaired and has been merged; it supplies equipment, evidence, trend, and maintenance-request foundations.
- `NVIDIA_API_KEY`, `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `MCP_SERVER_URL`, and service tokens are server-only.
- The browser never connects to Horizon or receives MCP/service credentials.
- The internal application API is the sole authorization and write boundary; the MCP server never connects to Neon.
- Read and write tools accept only validated UUIDs and typed fields. No tool accepts SQL, filesystem paths, URLs, or unvalidated actor identity from model output.
- Every state change requires an idempotency key and creates an append-only audit row.
- Horizon failure must not fail or roll back an inspection. It creates a retryable pending automation event and returns an honest pending outcome.
- Preserve existing deterministic rule and citation gates: model failures, retrieval failures, weak evidence, or invalid citations never create automatic maintenance requests.

---

## File Structure

- `prisma/schema.prisma`: audit and retry event relations.
- `prisma/migrations/<timestamp>_add_mcp_audit/migration.sql`: forward-only audit/retry schema.
- `lib/mcp-contract.ts`: Zod schemas matching the server repository JSON contracts.
- `lib/internal-tool-auth.ts`: current/previous service-token verification and request signature helpers.
- `lib/internal-tools.ts`: authorization-first service functions used by the internal routes.
- `lib/mcp-client.ts`: server-only Streamable HTTP client and typed tool calls.
- `lib/maintenance-agent.ts`: deterministic inspection/chat orchestration around NVIDIA and MCP calls.
- `app/api/internal/mcp-tools/*/route.ts`: service-token protected internal endpoint surface.
- `app/api/agent/chat/route.ts`: session-authenticated worker chat endpoint.
- `app/api/automation/retry/route.ts`: server-only retry trigger, not a browser endpoint.
- `components/agent-chat.tsx`: worker chat UI and tool outcome rendering.
- `tests/mcp-contract.test.ts`, `tests/internal-tools.test.ts`, `tests/mcp-client.test.ts`, `tests/maintenance-agent.test.ts`, `tests/agent-chat-routes.test.ts`: unit, route, and integration coverage.

### Task 1: Add audit and retry persistence

**Files:**
- Modify: `prisma/schema.prisma`, `lib/types.ts`
- Create: `prisma/migrations/<timestamp>_add_mcp_audit/migration.sql`, `tests/mcp-audit-schema.test.ts`

**Interfaces:** Produces `McpToolAuditLog` and `PendingAutomationEvent`; `MaintenanceNotification` gains an optional `sourceMcpAuditId` relation.

- [ ] **Step 1: Write failing migration contract tests**

```ts
it("keeps audit inputs free of raw prompts, image bytes, and secrets", () => {
  expect(schema).toContain("modelMetadata Json?");
  expect(schema).not.toContain("rawPrompt");
});

it("deduplicates retryable automation by inspection and operation", () => {
  expect(migration).toContain("pending_automation_events_inspection_operation_key");
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- --run tests/mcp-audit-schema.test.ts`

Expected: FAIL because the models and migration do not exist.

- [ ] **Step 3: Add forward-only models and migration**

Create an immutable forward migration. `mcp_tool_audit_logs` stores UUID IDs, request/call IDs, actor/equipment/inspection/maintenance IDs, trigger enum (`inspection`, `chat`, `retry`), tool name, sanitized JSON input/result, idempotency key, result category, citation IDs, model metadata, timestamps, and before/after status. `pending_automation_events` has a unique `(inspection_id, operation)` key, attempt count, safe failure code, next attempt time, and resolution time. Add check constraints for trigger/result/status values.

```ts
export type McpToolCallContext = {
  requestId: string;
  actorUserId: string;
  equipmentId: string;
  trigger: "inspection" | "chat" | "retry";
};
```

- [ ] **Step 4: Generate and verify**

Run: `npm.cmd run db:generate && npm.cmd run db:validate && npm.cmd test -- --run tests/mcp-audit-schema.test.ts`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

Run: `git add prisma lib/types.ts tests/mcp-audit-schema.test.ts && git commit -m "feat: add MCP audit persistence"`

### Task 2: Define cross-repository contracts and service authentication

**Files:**
- Create: `contracts/mcp-tools.v1.json`, `lib/mcp-contract.ts`, `lib/internal-tool-auth.ts`, `tests/mcp-contract.test.ts`, `tests/internal-tool-auth.test.ts`
- Modify: `.env.example`, `lib/env.ts`

**Interfaces:** Produces `verifyInternalToolRequest(request): Promise<ServicePrincipal>` and Zod schemas for all six tool inputs/results.

- [ ] **Step 1: Write failing contract/auth tests**

```ts
it("accepts the current and previous service token but rejects all other tokens", async () => {
  await expect(verifyInternalToolRequest(bearer("current"))).resolves.toMatchObject({ kind: "mcp" });
  await expect(verifyInternalToolRequest(bearer("unknown"))).rejects.toThrow("Unauthorized service");
});

it("requires a UUID requestId, actorUserId, equipmentId, and idempotencyKey for writes", () => {
  expect(createMaintenanceRequestSchema.safeParse({})).toMatchObject({ success: false });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- --run tests/mcp-contract.test.ts tests/internal-tool-auth.test.ts`

Expected: FAIL because contracts/authentication are absent.

- [ ] **Step 3: Implement versioned contract and token verification**

Add `MCP_SERVER_URL`, `MCP_SERVICE_TOKEN_CURRENT`, `MCP_SERVICE_TOKEN_PREVIOUS`, and `MCP_SERVICE_TIMEOUT_MS` only to server env validation/example. Use constant-time token comparison; reject missing/ambiguous authorization headers. The contract JSON contains exact JSON Schema for `list_equipment`, `get_equipment_history`, `get_inspection_evidence`, `search_evidence`, `create_maintenance_request`, and `update_maintenance_request_status`. TypeScript Zod schemas must have equivalent required fields and finite maximums.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- --run tests/mcp-contract.test.ts tests/internal-tool-auth.test.ts && npm.cmd run lint`

Run: `git add contracts lib .env.example tests && git commit -m "feat: add MCP tool contracts"`

### Task 3: Add authorization-first internal tool endpoints

**Files:**
- Create: `lib/internal-tools.ts`, `app/api/internal/mcp-tools/<tool>/route.ts`, `tests/internal-tools.test.ts`
- Modify: existing equipment, inspection, evidence, and maintenance services

**Interfaces:** Produces `executeInternalTool(name, context, input): Promise<ToolResult>`; every write uses `idempotencyKey` and persists audit before returning.

- [ ] **Step 1: Write failing ownership, idempotency, and audit tests**

```ts
it("rejects a service call when the actor cannot see the equipment", async () => {
  const response = await internalCall("get_equipment_history", privateEquipmentOfOtherUser);
  expect(response.status).toBe(403);
});

it("reuses a create request with the same idempotency key", async () => {
  const first = await internalCall("create_maintenance_request", validWrite);
  const second = await internalCall("create_maintenance_request", validWrite);
  expect(second.body.created).toBe(false);
  expect(await countMaintenanceRequests()).toBe(1);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- --run tests/internal-tools.test.ts`

Expected: FAIL because service endpoints are absent.

- [ ] **Step 3: Implement the six routes**

Authenticate service token, parse contract schema, authorize the forwarded actor against private/shared equipment, and call server-side services. Write routes must atomically enforce access and state transition in the update predicate, reuse idempotency results, and append sanitized audit entries. Read routes must only return citation metadata and safe text fields, never source file bytes or model prompts.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- --run tests/internal-tools.test.ts && npm.cmd run lint && npx.cmd tsc --noEmit`

Run: `git add app/api/internal lib tests && git commit -m "feat: add internal MCP tool API"`

### Task 4: Implement the server-only MCP client

**Files:**
- Create: `lib/mcp-client.ts`, `tests/mcp-client.test.ts`
- Modify: `package.json`, `package-lock.json`

**Interfaces:** Produces `callMcpTool<T>(name, input, schema, signal): Promise<ToolCallOutcome<T>>`.

- [ ] **Step 1: Write failing transport/error tests**

```ts
it("sends the service bearer token over Streamable HTTP and validates result schema", async () => {
  await expect(callMcpTool("list_equipment", validInput, listEquipmentResultSchema)).resolves.toMatchObject({ ok: true });
});

it("returns a retryable transport outcome instead of throwing for a Horizon timeout", async () => {
  await expect(callMcpTool("search_evidence", validInput, evidenceResultSchema)).resolves.toMatchObject({ retryable: true });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- --run tests/mcp-client.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement adapter**

Install the current `@modelcontextprotocol/client` SDK. Build `StreamableHTTPClientTransport` with the Horizon URL and server-only Authorization header, connect per bounded call or use a safely closed pool, call only the six allowlisted names, validate `isError`/content and output Zod schema, enforce `AbortSignal.timeout(MCP_SERVICE_TIMEOUT_MS)`, and sanitize provider/transport failures into retryable versus terminal outcomes.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- --run tests/mcp-client.test.ts && npm.cmd run lint`

Run: `git add package.json package-lock.json lib/mcp-client.ts tests/mcp-client.test.ts && git commit -m "feat: add Horizon MCP client"`

### Task 5: Add automatic and chat maintenance agent orchestration

**Files:**
- Create: `lib/maintenance-agent.ts`, `app/api/agent/chat/route.ts`, `tests/maintenance-agent.test.ts`, `tests/agent-chat-routes.test.ts`
- Modify: inspection save orchestration, NVIDIA adapter, existing maintenance workflow

**Interfaces:** Produces `runInspectionMaintenanceAgent(input): Promise<AutomationOutcome>` and `runWorkerChat(input): Promise<ChatOutcome>`.

- [ ] **Step 1: Write failing safety and retry tests**

```ts
it("does not fail a saved inspection when Horizon is unavailable", async () => {
  const outcome = await runInspectionMaintenanceAgent(highRiskInspection);
  expect(outcome).toMatchObject({ maintenanceStatus: "pending_retry" });
  expect(await pendingEventFor(highRiskInspection.id)).toBeTruthy();
});

it("records an audit entry and blocks a write when model citations are invalid", async () => {
  await expect(runWorkerChat(invalidCitationRequest)).resolves.toMatchObject({ wroteMaintenanceRequest: false });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- --run tests/maintenance-agent.test.ts tests/agent-chat-routes.test.ts`

Expected: FAIL because no agent exists.

- [ ] **Step 3: Implement orchestration**

Run deterministic trend rules and citation validation before write tools. Provide the NVIDIA model a constrained tool manifest and bounded, untrusted evidence; accept only contract-valid structured tool intents. Call MCP tools with request IDs/idempotency keys, persist audit outcomes, and queue a pending event only for retryable Horizon failures. Chat route authenticates the browser session, derives actor ID server-side, limits turns/tool calls per request, and returns text plus safe structured tool outcomes.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- --run tests/maintenance-agent.test.ts tests/agent-chat-routes.test.ts && npm.cmd test && npm.cmd run lint`

Run: `git add app/api/agent lib tests && git commit -m "feat: add maintenance MCP agent"`

### Task 6: Add worker chat UI and operations documentation

**Files:**
- Create: `components/agent-chat.tsx`, `tests/agent-chat-ui.test.ts`
- Modify: dashboard/equipment pages, `README.md`, `.env.example`

- [ ] **Step 1: Write failing UI tests**

```ts
it("shows a pending execution outcome without claiming a maintenance request exists", async () => {
  render(<AgentChat equipmentId="equipment-a" />);
  await submit("정비 요청을 만들어줘");
  expect(screen.getByText("정비 요청 실행이 보류되었습니다")).toBeVisible();
});

it("renders tool outcomes as text and safe application links only", () => {
  render(<AgentChat equipmentId="equipment-a" initialOutcome={outcome} />);
  expect(screen.queryByText("<script>")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- --run tests/agent-chat-ui.test.ts`

Expected: FAIL because chat UI is absent.

- [ ] **Step 3: Implement UI and docs**

Mount chat only after an equipment selection, display tool activity, citations, created/reused request IDs, legal status changes, and retry-pending outcomes. Render model strings strictly as text. Document Horizon variables, token rotation, retry operations, audit search, deployment smoke test, and that only the app is an allowed MCP client in Phase 1.

- [ ] **Step 4: Verify and commit**

Run: `npm.cmd test -- --run tests/agent-chat-ui.test.ts && npm.cmd test && npm.cmd run lint && npm.cmd run db:validate && npm.cmd run build`

Run: `git add app components README.md .env.example tests && git commit -m "feat: add maintenance agent chat"`

## Plan Self-Review

- Spec coverage: Tasks 1-3 provide audit, retry, contracts, and internal authority; Task 4 supplies the Horizon MCP client; Task 5 implements automatic/chat execution; Task 6 exposes and operates the feature.
- Scope: Separate FastMCP server implementation is intentionally in the paired plan below; this plan only owns the application host and shared contract source.
- Completeness: every task has a test, failure command, implementation direction, verification, and commit.
