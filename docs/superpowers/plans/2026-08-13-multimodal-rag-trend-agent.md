# Multimodal RAG Trend-Monitoring Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add equipment-scoped multimodal RAG, cited trend analysis, and automatic in-app maintenance notifications to the inspection application.

**Architecture:** Keep the existing Next.js App Router and Prisma/Postgres application boundary. Store equipment, source documents, chunks, analyses, and notifications in Postgres; call NVIDIA hosted embedding, VLM reranking, and Nemotron VLM services behind server-only adapters. A deterministic rule evaluator decides alert creation; the analysis model explains only bounded retrieval evidence and supplies verifiable citations.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Prisma 7, PostgreSQL with pgvector, NVIDIA hosted NIM APIs, Zod, Sharp, Vitest.

## Global Constraints

- Require a worker-selected equipment record for every inspection; do not use OCR text as the inspection-to-equipment join key.
- Keep `NVIDIA_API_KEY`, `DATABASE_URL`, `DIRECT_URL`, and `SESSION_SECRET` server-only.
- Use `nvidia/llama-nemotron-embed-vl-1b-v2` for multimodal indexing and `nvidia/llama-nemotron-rerank-vl-1b-v2` for candidate reranking.
- Use `nvidia/nemotron-nano-12b-v2-vl` only for structured cited analysis, never to decide whether an automatic urgent notification is created.
- Preserve source document/page or inspection ID in every retrieval chunk and reject generated citations that are absent from the supplied context.
- Do not create an automatic notification when retrieval fails, evidence is insufficient, provider output is invalid, or citation validation fails.
- Restrict document and policy administration to administrators; workers may create equipment only during inspection.
- Keep Graph RAG, external document connectors, and external CMMS/email/chat delivery out of this plan.

---

## File Structure

- `prisma/schema.prisma`: Models and relations for equipment, document ingestion, chunks, trend analyses, and maintenance notifications.
- `prisma/migrations/<timestamp>_add_trend_agent/migration.sql`: pgvector extension, vector columns/indexes, constraints, and schema migration.
- `lib/equipment.ts`: Normalization and user-authorized equipment creation/listing.
- `lib/knowledge.ts`: Document metadata lifecycle and chunk persistence.
- `lib/retrieval.ts`: NVIDIA embedding/reranking adapters, metadata-filtered similarity search, and citation-bound context.
- `lib/trend-rules.ts`: Pure deterministic alert rule evaluation and notification deduplication key generation.
- `lib/trend-agent.ts`: Orchestrates retrieval, analysis JSON validation, citation verification, and conditional notification creation.
- `app/api/equipment/route.ts`: Worker equipment list/create endpoint.
- `app/api/knowledge-documents/route.ts`: Administrator document upload/list endpoint.
- `app/api/knowledge-documents/[id]/retry/route.ts`: Administrator retry endpoint for failed indexing.
- `app/api/equipment/[id]/trend/route.ts`: Equipment-scoped, on-demand analysis endpoint.
- `app/api/maintenance-notifications/route.ts`: User-visible notification list endpoint.
- `app/api/maintenance-notifications/[id]/route.ts`: Notification acknowledgement/completion endpoint.
- `components/equipment-select.tsx`, `components/document-manager.tsx`, `components/trend-analysis.tsx`, `components/maintenance-notifications.tsx`: Focused client UI components.
- `app/equipment/[id]/page.tsx`, `app/admin/knowledge/page.tsx`, `app/maintenance/page.tsx`: Route-level screens.
- `tests/equipment.test.ts`, `tests/knowledge.test.ts`, `tests/retrieval.test.ts`, `tests/trend-rules.test.ts`, `tests/trend-agent.test.ts`, `tests/trend-routes.test.ts`: Unit and route tests.

### Task 1: Add schema foundation and pgvector migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_trend_agent/migration.sql`
- Modify: `lib/types.ts`
- Test: `tests/trend-schema.test.ts`

**Interfaces:**
- Produces Prisma models `Equipment`, `KnowledgeDocument`, `KnowledgeChunk`, `TrendAnalysis`, and `MaintenanceNotification`.
- Extends `InspectionRecord` with `equipmentId: string`.
- Produces types `TrendOutcome`, `Citation`, `TrendAnalysisResult`, and `MaintenanceNotificationStatus` from `lib/types.ts`.

- [ ] **Step 1: Write failing schema assertions**

```ts
it("requires equipment for inspections and unique normalized equipment numbers", () => {
  expect(prismaSchema).toContain("equipmentId");
  expect(prismaSchema).toContain("equipmentNumber String @unique");
});

it("stores chunk provenance and an agent notification deduplication key", () => {
  expect(prismaSchema).toContain("pageNumber");
  expect(prismaSchema).toContain("deduplicationKey");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- --run tests/trend-schema.test.ts`

Expected: FAIL because the new models and fields are absent.

- [ ] **Step 3: Implement the minimal Prisma schema and migration**

Add the models and relations listed above. Add `Inspection.equipmentId` as a nullable field first, write a data migration that creates an `Unassigned` equipment record for each user that has legacy inspections, backfill those inspections, then make the column non-null. Add `CREATE EXTENSION IF NOT EXISTS vector;` and a `vector` column to `knowledge_chunks` using the selected embedding dimension obtained from the NVIDIA model documentation at implementation time. Use a Postgres `CHECK` constraint for allowed notification statuses/outcomes and a unique index on `maintenance_notifications(deduplication_key)`.

- [ ] **Step 4: Generate and validate Prisma artifacts**

Run: `npm.cmd run db:generate && npm.cmd run db:validate && npm.cmd test -- --run tests/trend-schema.test.ts`

Expected: all commands exit 0.

- [ ] **Step 5: Commit schema foundation**

Run: `git add prisma lib/types.ts tests/trend-schema.test.ts && git commit -m "feat: add trend agent schema"`

### Task 2: Implement equipment selection and authorization

**Files:**
- Create: `lib/equipment.ts`
- Create: `app/api/equipment/route.ts`
- Modify: `app/api/inspections/route.ts`
- Modify: `lib/inspection.ts`
- Test: `tests/equipment.test.ts`
- Test: `tests/inspection-routes.test.ts`

**Interfaces:**
- Consumes `Equipment` from Task 1 and `getCurrentUser()` from `lib/auth.ts`.
- Produces `createEquipment(userId, { equipmentNumber, name, location }): Promise<EquipmentSummary>` and `listEquipmentForUser(userId): Promise<EquipmentSummary[]>`.
- Changes inspection creation input to include `equipmentId: string`.

- [ ] **Step 1: Write failing equipment normalization and ownership tests**

```ts
it("normalizes equipment numbers and rejects duplicates", async () => {
  await createEquipment("user-a", { equipmentNumber: "  BAT-01 ", name: "Battery A", location: null });
  await expect(createEquipment("user-a", { equipmentNumber: "bat-01", name: "Duplicate", location: null }))
    .rejects.toMatchObject({ code: "P2002" });
});

it("rejects an inspection request that selects an inaccessible equipment record", async () => {
  const response = await postInspectionAs("user-a", { equipmentId: "equipment-b" });
  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm.cmd test -- --run tests/equipment.test.ts tests/inspection-routes.test.ts`

Expected: FAIL because no equipment service or required request field exists.

- [ ] **Step 3: Implement equipment service and inspection integration**

Normalize numbers via `trim().toLowerCase()`. `POST /api/equipment` accepts a 1–80 character number/name and optional 1–160 character location; it creates a worker-created record. `GET /api/equipment` returns the caller's permitted equipment. Require `equipmentId` in multipart inspection input, validate UUID syntax, and query it under the current user's authorization before saving an inspection.

- [ ] **Step 4: Run focused tests and lint**

Run: `npm.cmd test -- --run tests/equipment.test.ts tests/inspection-routes.test.ts && npm.cmd run lint`

Expected: all commands exit 0.

- [ ] **Step 5: Commit equipment workflow**

Run: `git add lib/equipment.ts app/api/equipment app/api/inspections lib/inspection.ts tests/equipment.test.ts tests/inspection-routes.test.ts && git commit -m "feat: require equipment for inspections"`

### Task 3: Add administrator document ingestion and provenance-preserving chunks

**Files:**
- Create: `lib/knowledge.ts`
- Create: `lib/document-extraction.ts`
- Create: `app/api/knowledge-documents/route.ts`
- Create: `app/api/knowledge-documents/[id]/retry/route.ts`
- Test: `tests/knowledge.test.ts`

**Interfaces:**
- Consumes `KnowledgeDocument` and `KnowledgeChunk` from Task 1.
- Produces `ingestKnowledgeDocument(documentId): Promise<void>`, `createKnowledgeDocument(adminId, file): Promise<KnowledgeDocumentSummary>`, and `retryKnowledgeDocument(adminId, documentId): Promise<void>`.
- Every extracted chunk has `{ documentId, pageNumber, chunkOrder, sourceType, text, imagePath, metadata }`.

- [ ] **Step 1: Write failing ingestion lifecycle tests**

```ts
it("marks a document ready only after every persisted chunk has page provenance", async () => {
  await ingestKnowledgeDocument("document-a");
  expect(savedDocument.status).toBe("ready");
  expect(savedChunks.every((chunk) => chunk.pageNumber >= 1 && chunk.documentId === "document-a")).toBe(true);
});

it("marks a failed extraction as failed and excludes it from retrieval", async () => {
  await expect(ingestKnowledgeDocument("bad-document")).rejects.toThrow();
  expect(savedDocument.status).toBe("failed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- --run tests/knowledge.test.ts`

Expected: FAIL because the ingestion service is absent.

- [ ] **Step 3: Implement secure document lifecycle**

Create an explicit `isAdmin(user)` guard used by both document routes. Accept PDF, PNG, JPEG, and WebP files under the configured document-size limit, save them below a non-public document storage directory, and create an `uploaded` record. Set `indexing` before extraction; extract page/source units; persist chunks transactionally; then set `ready`. Catch extraction errors, set `failed` with a safe error message, and retain no partial chunks. Retry deletes old failed chunks only after verifying administrator access.

- [ ] **Step 4: Run tests and lint**

Run: `npm.cmd test -- --run tests/knowledge.test.ts && npm.cmd run lint`

Expected: both commands exit 0.

- [ ] **Step 5: Commit document ingestion**

Run: `git add lib/knowledge.ts lib/document-extraction.ts app/api/knowledge-documents tests/knowledge.test.ts && git commit -m "feat: add cited knowledge document ingestion"`

### Task 4: Implement NVIDIA multimodal embedding, retrieval, and reranking

**Files:**
- Create: `lib/retrieval.ts`
- Modify: `lib/nvidia.ts`
- Modify: `lib/knowledge.ts`
- Test: `tests/retrieval.test.ts`

**Interfaces:**
- Consumes ready chunks from Task 3 and equipment/inspection metadata from Task 2.
- Produces `embedMultimodal(input): Promise<number[]>`, `searchEvidence(input): Promise<RetrievedEvidence[]>`, and `rerankEvidence(query, candidates): Promise<RetrievedEvidence[]>`.
- `RetrievedEvidence` is `{ citationId, sourceType, documentId?, pageNumber?, inspectionId?, content, score, metadata }`.

- [ ] **Step 1: Write failing metadata-filter and citation tests**

```ts
it("retrieves only ready document chunks and inspection chunks for the requested equipment", async () => {
  const results = await searchEvidence({ equipmentId: "eq-a", query: "battery swelling", limit: 8 });
  expect(results.every((item) => item.metadata.equipmentId === "eq-a" || item.sourceType !== "inspection")).toBe(true);
  expect(results.every((item) => item.citationId.length > 0)).toBe(true);
});

it("sends vector candidates through NVIDIA VLM reranking before returning context", async () => {
  await searchEvidence({ equipmentId: "eq-a", query: "burn mark", limit: 5 });
  expect(mockRerank).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- --run tests/retrieval.test.ts`

Expected: FAIL because retrieval adapters are absent.

- [ ] **Step 3: Implement bounded retrieval**

Add server-only NVIDIA calls for the selected VLM embedding and reranking models using their current official API request schemas. Store/query vectors through parameterized Prisma raw SQL only; never interpolate user input. Retrieve a bounded candidate count, filter document chunks to `ready`, filter inspection chunks to the requested equipment ID, rerank candidates, and return at most eight citation-bearing context items. Treat retrieved text, OCR, and document content as untrusted data in every model prompt.

- [ ] **Step 4: Run tests and lint**

Run: `npm.cmd test -- --run tests/retrieval.test.ts && npm.cmd run lint`

Expected: both commands exit 0.

- [ ] **Step 5: Commit retrieval pipeline**

Run: `git add lib/retrieval.ts lib/nvidia.ts lib/knowledge.ts tests/retrieval.test.ts && git commit -m "feat: add multimodal evidence retrieval"`

### Task 5: Implement deterministic rules, cited analysis, and notification creation

**Files:**
- Create: `lib/trend-rules.ts`
- Create: `lib/trend-agent.ts`
- Create: `app/api/equipment/[id]/trend/route.ts`
- Create: `app/api/maintenance-notifications/route.ts`
- Create: `app/api/maintenance-notifications/[id]/route.ts`
- Modify: `lib/inspection.ts`
- Test: `tests/trend-rules.test.ts`
- Test: `tests/trend-agent.test.ts`
- Test: `tests/trend-routes.test.ts`

**Interfaces:**
- Consumes `searchEvidence()` from Task 4 and `InspectionRecord` from Task 2.
- Produces `evaluateTrendRules(history, current): RuleOutcome`, `analyzeEquipmentTrend(input): Promise<TrendAnalysisResult>`, and `createOrReuseMaintenanceNotification(analysis): Promise<MaintenanceNotification>`.

- [ ] **Step 1: Write failing rule and citation-validation tests**

```ts
it("creates an urgent rule outcome for a current high-severity visual finding", () => {
  expect(evaluateTrendRules([], inspectionWithHighFinding)).toMatchObject({ outcome: "urgent", reason: "current_high_severity" });
});

it("rejects agent output that cites an item missing from supplied evidence", async () => {
  await expect(analyzeEquipmentTrend({ equipmentId: "eq-a", triggerInspectionId: "i-a" }))
    .rejects.toThrow("Unverifiable citation");
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm.cmd test -- --run tests/trend-rules.test.ts tests/trend-agent.test.ts tests/trend-routes.test.ts`

Expected: FAIL because the evaluator, agent, and routes are absent.

- [ ] **Step 3: Implement orchestration in fixed order**

Implement the three default rules from the design: current high-severity finding; same normalized abnormal finding in two consecutive inspections; 30-day abnormal-count increase. Evaluate rules before calling the model. Retrieve bounded evidence; if none is sufficient, persist `additional_inspection_required` and return without notification. Otherwise call Nemotron VLM for strict JSON `{ outcome, evidenceSummary, trendDescription, recommendedActions, confidence, citations }`, validate all citation IDs against the retrieved context, persist the analysis, and create/reuse a notification only for qualifying urgent outcomes. Call this workflow automatically after an inspection saves, and expose a user-authorized on-demand equipment trend route.

- [ ] **Step 4: Implement notification state transitions**

`GET /api/maintenance-notifications` returns only notifications visible to the current user. `PATCH /api/maintenance-notifications/:id` accepts only `acknowledged` or `completed`, validates current access, and records actor/time. Reject illegal reverse transitions and cross-user access with 403/409 as applicable.

- [ ] **Step 5: Run focused tests and lint**

Run: `npm.cmd test -- --run tests/trend-rules.test.ts tests/trend-agent.test.ts tests/trend-routes.test.ts && npm.cmd run lint`

Expected: all commands exit 0.

- [ ] **Step 6: Commit agent workflow**

Run: `git add lib/trend-rules.ts lib/trend-agent.ts lib/inspection.ts app/api/equipment app/api/maintenance-notifications tests/trend-rules.test.ts tests/trend-agent.test.ts tests/trend-routes.test.ts && git commit -m "feat: add cited trend monitoring agent"`

### Task 6: Build equipment, knowledge, trend, and notification UI

**Files:**
- Create: `components/equipment-select.tsx`
- Create: `components/document-manager.tsx`
- Create: `components/trend-analysis.tsx`
- Create: `components/maintenance-notifications.tsx`
- Create: `app/equipment/[id]/page.tsx`
- Create: `app/admin/knowledge/page.tsx`
- Create: `app/maintenance/page.tsx`
- Modify: `components/inspection-form.tsx`
- Modify: `components/inspection-detail.tsx`
- Test: `tests/trend-ui.test.ts`

**Interfaces:**
- Consumes Equipment and analysis/notification response types from Tasks 2 and 5.
- Produces `EquipmentSelect`, `TrendAnalysis`, and `MaintenanceNotifications` UI components.

- [ ] **Step 1: Write failing UI behavior tests**

```ts
it("requires a selected equipment before it posts an inspection form", async () => {
  renderInspectionForm();
  await userEvent.click(screen.getByRole("button", { name: "검사 실행" }));
  expect(screen.getByText("설비를 선택하세요")).toBeVisible();
});

it("renders agent citations as document page or inspection links", () => {
  renderTrendAnalysis(analysisWithCitations);
  expect(screen.getByRole("link", { name: "매뉴얼 p.12" })).toBeVisible();
  expect(screen.getByRole("link", { name: "검사 #149" })).toBeVisible();
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run: `npm.cmd test -- --run tests/trend-ui.test.ts`

Expected: FAIL because the components and routes are absent.

- [ ] **Step 3: Implement mobile-first user paths**

Add a required equipment selector plus inline create-equipment action to the inspection form. Render immediate automatic outcome, cited evidence, recommended actions, and a non-actionable `추가 점검 필요` state when evidence is insufficient. Add equipment detail history/on-demand analysis, admin document management with indexing status/retry, and notification list/status update views. Do not render model-supplied HTML; render all strings as text.

- [ ] **Step 4: Run UI tests, full suite, lint, and build**

Run: `npm.cmd test -- --run tests/trend-ui.test.ts && npm.cmd test && npm.cmd run lint && npm.cmd run build`

Expected: all commands exit 0. If the known host SWC issue blocks `next build`, capture its output separately while keeping test and lint evidence.

- [ ] **Step 5: Commit UI**

Run: `git add app components tests/trend-ui.test.ts && git commit -m "feat: add trend agent user interface"`

### Task 7: Document administration, migration, and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Test: `tests/trend-e2e.test.ts`

**Interfaces:**
- Consumes all prior tasks.
- Produces documented environment variables, migration instructions, and an automated end-to-end test path.

- [ ] **Step 1: Write a failing end-to-end test with mocked NVIDIA services**

```ts
it("indexes an administrator document, analyzes a high-risk inspection, and creates one urgent notification", async () => {
  const document = await uploadAsAdmin(pdfFixture);
  await waitForDocumentReady(document.id);
  const inspection = await submitInspectionAsWorker({ equipmentId: "eq-a", visualFinding: "high" });
  expect(inspection.trendOutcome).toBe("urgent");
  expect(await listNotifications("worker-a")).toHaveLength(1);
  expect((await getNotification()).status).toBe("new");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd test -- --run tests/trend-e2e.test.ts`

Expected: FAIL until the complete workflow is wired.

- [ ] **Step 3: Document operational setup**

Document pgvector migration application, NVIDIA model/API variables, administrator first-document workflow, indexing/retry states, automatic notification rules, notification-state management, and the fact that Graph RAG is intentionally not part of Phase 1. Add only required new variables to `.env.example`; do not add secret values.

- [ ] **Step 4: Run all verification**

Run: `npm.cmd test && npm.cmd run lint && npm.cmd run db:validate && npm.cmd run build`

Expected: tests, lint, and Prisma validation exit 0. If build is blocked by the pre-existing host SWC binary failure, record that exact environmental blocker and verify no application compilation error precedes it.

- [ ] **Step 5: Commit documentation and verification**

Run: `git add README.md .env.example tests/trend-e2e.test.ts && git commit -m "docs: add trend agent operations guide"`

## Plan Self-Review

- Spec coverage: Tasks 1–2 establish equipment ownership and persistence; Tasks 3–4 ingest/cite multimodal sources and retrieve bounded evidence; Task 5 implements deterministic alerts, cited analysis, deduplicated notifications, and on-demand analysis; Task 6 exposes all approved user/admin flows; Task 7 covers operations and E2E verification.
- Placeholder scan: no implementation placeholders or undefined interfaces remain; intentionally deferred Graph RAG is excluded from tasks.
- Type consistency: `EquipmentSummary`, `RetrievedEvidence`, `TrendAnalysisResult`, `RuleOutcome`, and `MaintenanceNotification` are created before their downstream consumers.
