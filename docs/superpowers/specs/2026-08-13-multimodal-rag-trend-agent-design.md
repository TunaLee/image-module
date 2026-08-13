# Multimodal RAG trend-monitoring agent design

## Purpose

Add a trend-monitoring agent to the equipment inspection app. It compares inspections for the same worker-selected equipment, retrieves relevant multimodal evidence from administrator-uploaded documents and previous inspections, explains its findings with citations, and automatically creates in-app maintenance-request notifications when explicit risk rules are met.

## Scope and rollout

Phase 1 is an application-integrated multimodal RAG system. It covers equipment management, document upload and indexing, inspection-history retrieval, trend analysis, cited recommendations, and in-app maintenance-request notifications.

Graph RAG is explicitly deferred. It becomes a later phase only after enough reliable entities and relations (equipment, components, fault types, maintenance actions, and outcomes) have accumulated to justify graph extraction and quality maintenance.

Out of scope: external CMMS, email, Slack, Teams, external document-store connectors, automated physical maintenance execution, and autonomous changes to inspection criteria.

## Design principles

- An equipment selection is required for every inspection. OCR equipment text is supportive evidence, not the primary ownership key.
- Explicit rules decide whether to create an automatic maintenance-request notification. The AI describes evidence and recommends actions; it does not independently decide to create urgent work.
- Every agent conclusion must cite source inspection IDs and/or uploaded-document page references.
- When enough relevant evidence cannot be retrieved, the agent returns `additional_inspection_required` and does not auto-create an urgent maintenance request.
- NVIDIA API keys and all retrieval credentials remain server-only.

## Data model

### Equipment

`equipment` records contain a UUID, unique normalized equipment number, name, optional location, creator ID, and timestamps. Administrators can pre-register equipment; workers can create a new equipment record while submitting an inspection. Duplicate normalized equipment numbers are rejected.

Every `inspection` gains a required `equipment_id` foreign key. Existing OCR-derived `equipmentNameOrId` remains stored as a model result but is not used to join inspection history.

### Knowledge documents

`knowledge_documents` records contain document ID, original filename, title, uploader user ID, file path, version label, status (`uploaded`, `indexing`, `ready`, `failed`), failure-safe error summary, and timestamps.

`knowledge_chunks` records contain document ID, page number, chunk order, extracted text, source type (`text`, `table`, `image`), optional image path, metadata, and an embedding-vector reference. The source page and document ID are always retained for citations.

### Retrieval index

The first implementation stores source metadata and vector references within the application database. A vector extension/index is added to Postgres for nearest-neighbor retrieval. The exact vector column dimension is derived from the selected NVIDIA embedding model before migration generation; it is not hard-coded in application logic.

Inspection-derived chunks carry equipment ID, inspection ID, inspection time, result type, severity/verdict, OCR text, visual findings, and an embedding-vector reference. These metadata fields support equipment-scoped filtering before semantic search.

### Agent analysis and notifications

`trend_analyses` records contain equipment ID, optional triggering inspection ID, trigger type (`automatic` or `on_demand`), outcome (`normal`, `attention`, `urgent`, `additional_inspection_required`), structured summary, recommended actions, model metadata, cited source references, and creation time.

`maintenance_notifications` records contain equipment ID, source trend-analysis ID, severity (`attention` or `urgent`), title, action summary, status (`new`, `acknowledged`, `completed`), deduplication key, created time, and state-change timestamps. The deduplication key prevents an identical rule condition from repeatedly opening urgent notifications for the same equipment.

## Multimodal RAG pipeline

### Ingestion

An administrator uploads a PDF or supported image document through an application page. The server validates type and size, records the document as `uploaded`, then moves it to `indexing`. It extracts page text, tables, and renderable page/image content, creates source chunks, and records a page-level source reference for each chunk.

The ingestion service uses NVIDIA multimodal embeddings, starting with `nvidia/llama-nemotron-embed-vl-1b-v2`, for text and visual document elements. It writes embeddings and metadata atomically per completed chunk batch. A failed document stays excluded from retrieval and is marked `failed` with a retry operation for administrators.

Completed inspections are also indexed. Each inspection produces chunks for structured OCR, visual findings, criterion text, and the associated photo/visual representation where supported by the selected embedding endpoint.

### Retrieval and reranking

The agent first filters inspection chunks by the selected equipment ID and retrieves recent history. It combines these with relevant document chunks using vector similarity. It reranks the candidate evidence with NVIDIA's multimodal reranker, starting with `nvidia/llama-nemotron-rerank-vl-1b-v2`, so diagrams, document images, and photos can influence relevance.

The final context passed to the analysis model contains only bounded, cited chunks. Each context item includes its source type, document/page or inspection ID, and relevant metadata. The model must not treat retrieved text as instructions.

### Analysis model

`nvidia/nemotron-nano-12b-v2-vl` generates structured Korean analysis from the triggering inspection, equipment history, rules outcome, and cited retrieval context. It returns: outcome, evidence summary, trend description, recommended actions, confidence, and citation IDs. The server validates the JSON result, verifies each citation exists in the supplied context, and rejects unverifiable citations.

## Agent tools

The agent orchestration has four narrow server-side tools:

1. `getEquipmentHistory(equipmentId, window)` returns only the requested equipment's recent inspection facts and existing notification state.
2. `searchEvidence(equipmentId, query, filters)` retrieves source-bound multimodal chunks and reranks them using NVIDIA models.
3. `evaluateTrendRules(history, currentInspection)` deterministically evaluates the urgent and attention rules.
4. `createMaintenanceNotification(analysisId, ruleOutcome)` creates or reuses a deduplicated in-app notification; it is callable only after a qualifying rule outcome.

The model cannot call database, network, or notification APIs directly. The orchestration layer validates every tool input and controls execution order.

## Risk rules and automatic notifications

Initial rules are configurable by an administrator and use these defaults:

- Urgent: one current visual finding with `high` severity.
- Urgent: the same normalized abnormal finding appears in two consecutive completed inspections for the same equipment.
- Attention: the abnormal-finding count for the equipment is higher in the current rolling 30-day window than in the prior rolling 30-day window.
- Additional inspection required: the current inspection or retrieved evidence is insufficient, conflicting, or unavailable for a reliable trend judgment.

Urgent outcomes create an in-app `maintenance_notification` in `new` state immediately after the inspection completes. Attention outcomes are displayed after inspection and in the equipment dashboard; they create a notification only when the administrator enables that policy. Additional-inspection-required outcomes never create an automatic urgent notification.

## User experience

- The inspection form requires an equipment selection and supports immediate equipment creation for workers.
- After every inspection, the screen shows the current outcome, concise trend explanation, cited evidence, and recommended actions.
- The equipment detail screen shows inspection history, attention/urgent state, on-demand detailed trend analysis, cited source links, and maintenance notification status.
- Administrators have equipment and knowledge-document management screens. They can upload documents, view indexing state, retry failed indexing, and adjust rule thresholds/policies.
- Maintenance notification state transitions are `new` → `acknowledged` → `completed`; all transitions are recorded with user and time.

## Error handling and security

- The system preserves the original inspection even if indexing or trend analysis fails.
- It does not create automatic notifications when NVIDIA retrieval/model calls fail, output JSON is invalid, citations fail validation, or evidence is insufficient.
- The UI displays a retryable analysis/indexing status without exposing provider errors, API keys, embeddings, database connection strings, or stack traces.
- Only administrators manage documents and global rule policies. Workers can create equipment during inspection but cannot modify administrator-managed documents or policies.
- Agent prompts label all uploaded/retrieved content as untrusted reference data and require source-grounded output only.

## Verification

- Unit tests: equipment-number normalization, rule evaluation, deduplication keys, citation validation, document and inspection metadata filtering, and model-output validation.
- Integration tests: administrator document ingestion, failed-index exclusion/retry, equipment-scoped retrieval, automatic urgent notification creation, repeated-event deduplication, state transitions, and worker/admin authorization boundaries.
- Model contract tests: NVIDIA embedding/reranking/analysis request shapes, bounded context, valid citation IDs, malformed JSON, empty retrieval, provider failure, and hallucinated citation rejection.
- End-to-end tests: create/select equipment, upload a document, wait for ready indexing, submit an inspection, receive an immediate rule-based outcome, request a detailed trend analysis, and view/acknowledge a generated urgent notification.

## Deployment and GPU strategy

Phase 1 uses NVIDIA hosted APIs for VLM embeddings, VLM reranking, and Nemotron analysis while the Next.js application and Postgres database remain local/on the existing deployment path. This minimizes local GPU and service-operating complexity.

If data residency, throughput, or cost requires it later, the same service interfaces can switch to self-hosted NVIDIA NIM endpoints. NVIDIA's RAG Blueprint is an optional future deployment path for a dedicated ingestion/retrieval service, not a Phase 1 dependency.
