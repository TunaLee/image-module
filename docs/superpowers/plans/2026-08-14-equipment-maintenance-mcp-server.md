# Equipment Maintenance MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and deploy a separate Python/FastMCP repository that exposes six authenticated equipment-maintenance tools to the application host through Prefect Horizon.

**Architecture:** The server is a stateless Streamable HTTP FastMCP adapter. It verifies a rotation-capable service bearer token, validates versioned JSON contracts, then calls the Next.js application's internal service API. It owns no database, NVIDIA credential, or browser identity.

**Tech Stack:** Python 3.12, FastMCP, Pydantic v2, httpx, pytest, ruff, mypy, Prefect Horizon.

## Global Constraints

- Create this as a new Git repository named `equipment-maintenance-mcp`, not a directory committed to the application repository.
- The application plan must publish `contracts/mcp-tools.v1.json` before this server is implemented.
- Use Streamable HTTP in stateless mode and expose only the `/mcp` endpoint.
- Authenticate the application host with current/previous service Bearer tokens using constant-time comparison.
- Never hold `DATABASE_URL`, `DIRECT_URL`, `NVIDIA_API_KEY`, or user browser sessions in this repository.
- Proxy only the six allowlisted tool names to the application internal API; do not implement generic HTTP forwarding.
- Pass request ID, actor ID, equipment ID, trigger, and idempotency key unchanged to the application; do not authorize users locally.
- Return typed safe errors; never include bearer tokens, raw response bodies, image bytes, or model prompts.

---

## File Structure

- `pyproject.toml`: pinned Python/runtime/test/lint configuration.
- `src/equipment_maintenance_mcp/server.py`: `FastMCP` construction and stateless HTTP ASGI app.
- `src/equipment_maintenance_mcp/settings.py`: validated environment settings.
- `src/equipment_maintenance_mcp/auth.py`: current/previous token verifier.
- `src/equipment_maintenance_mcp/contracts.py`: Pydantic models generated from/copied from application contract v1.
- `src/equipment_maintenance_mcp/app_client.py`: allowlisted authenticated internal API client.
- `src/equipment_maintenance_mcp/tools.py`: six FastMCP decorators.
- `tests/`: server, auth, contract, tool, and client tests.
- `prefect.yaml`: Horizon deployment metadata.
- `.github/workflows/ci.yml`: test/lint/type-check and contract compatibility workflow.

### Task 1: Bootstrap the separate repository and contract fixture

**Files:** Create all repository root config, `contracts/mcp-tools.v1.json`, `src/equipment_maintenance_mcp/__init__.py`, `tests/test_contracts.py`.

**Interfaces:** Produces installable package `equipment_maintenance_mcp` and one checked-in byte-for-byte contract fixture from the application repository.

- [ ] **Step 1: Write failing contract availability test**

```py
def test_v1_contract_defines_exactly_six_tools() -> None:
    contract = load_contract()
    assert set(contract["tools"]) == {
        "list_equipment", "get_equipment_history", "get_inspection_evidence",
        "search_evidence", "create_maintenance_request", "update_maintenance_request_status",
    }
```

- [ ] **Step 2: Verify it fails**

Run: `uv run pytest tests/test_contracts.py -q`

Expected: FAIL because the package/fixture is absent.

- [ ] **Step 3: Add Python package configuration**

Create `pyproject.toml` with Python `>=3.12`, FastMCP, httpx, Pydantic, pytest, ruff, and mypy. Copy the exact published application v1 JSON contract to `contracts/`; add a script that verifies its SHA-256 against an explicit release/tag during CI.

- [ ] **Step 4: Verify and commit**

Run: `uv run pytest tests/test_contracts.py -q && uv run ruff check . && uv run mypy src`

Run: `git add . && git commit -m "chore: bootstrap maintenance MCP server"`

### Task 2: Implement settings and service-token authentication

**Files:** Create `settings.py`, `auth.py`, `tests/test_auth.py`.

**Interfaces:** Produces `Settings.from_env()` and `verify_bearer_token(header: str | None, settings: Settings) -> None`.

- [ ] **Step 1: Write failing token tests**

```py
def test_accepts_current_or_previous_token() -> None:
    settings = Settings(app_internal_api_url="https://app.internal", current_token="new", previous_token="old")
    verify_bearer_token("Bearer new", settings)
    verify_bearer_token("Bearer old", settings)

def test_rejects_missing_or_unknown_token() -> None:
    with pytest.raises(UnauthorizedService):
        verify_bearer_token(None, settings())
```

- [ ] **Step 2: Verify it fails**

Run: `uv run pytest tests/test_auth.py -q`

Expected: FAIL because auth is absent.

- [ ] **Step 3: Implement validated settings/auth**

Require `APP_INTERNAL_API_URL`, `MCP_SERVICE_TOKEN_CURRENT`, `MCP_SERVICE_TIMEOUT_SECONDS`; permit optional previous token. Reject non-HTTPS URLs outside explicit local test mode. Parse exactly one Bearer credential, use `hmac.compare_digest`, and expose no token value in exceptions/logs.

- [ ] **Step 4: Verify and commit**

Run: `uv run pytest tests/test_auth.py -q && uv run ruff check . && uv run mypy src`

Run: `git add src tests && git commit -m "feat: add MCP service authentication"`

### Task 3: Implement typed internal application client

**Files:** Create `contracts.py`, `app_client.py`, `tests/test_app_client.py`.

**Interfaces:** Produces `ApplicationToolClient.call(tool: ToolName, payload: ToolInput) -> ToolOutput`.

- [ ] **Step 1: Write failing allowlist and timeout tests**

```py
async def test_posts_only_allowlisted_internal_tool_path(httpx_mock) -> None:
    client = ApplicationToolClient(settings())
    await client.call("list_equipment", valid_list_input())
    assert httpx_mock.get_requests()[0].url.path == "/api/internal/mcp-tools/list_equipment"

async def test_maps_timeout_to_safe_retryable_error(httpx_mock) -> None:
    httpx_mock.add_exception(httpx.TimeoutException("timeout"))
    with pytest.raises(RetryableToolError):
        await ApplicationToolClient(settings()).call("search_evidence", valid_search_input())
```

- [ ] **Step 2: Verify tests fail**

Run: `uv run pytest tests/test_app_client.py -q`

Expected: FAIL because the client is absent.

- [ ] **Step 3: Implement client**

Use one httpx async client with fixed base URL, timeout, no redirects, service Authorization header, and `X-Request-Id`. Route only enum tool names to hardcoded paths; Pydantic validates request and response against v1 contract models. Convert 401/403/409/422 to terminal safe errors; convert timeout/502/503/504 to retryable safe errors.

- [ ] **Step 4: Verify and commit**

Run: `uv run pytest tests/test_app_client.py -q && uv run ruff check . && uv run mypy src`

Run: `git add src tests && git commit -m "feat: add internal application client"`

### Task 4: Register six stateless FastMCP tools

**Files:** Create `tools.py`, `server.py`, `tests/test_tools.py`, `tests/test_server.py`.

**Interfaces:** Produces `mcp` and six exact tool names with Pydantic input/output schemas.

- [ ] **Step 1: Write failing discovery/delegation tests**

```py
async def test_server_discovers_only_the_v1_tools(client) -> None:
    tools = await client.list_tools()
    assert {tool.name for tool in tools} == EXPECTED_TOOL_NAMES

async def test_create_request_forwards_idempotency_key(client, app_client_mock) -> None:
    await client.call_tool("create_maintenance_request", valid_create_input())
    app_client_mock.call.assert_awaited_once_with("create_maintenance_request", valid_create_input())
```

- [ ] **Step 2: Verify tests fail**

Run: `uv run pytest tests/test_tools.py tests/test_server.py -q`

Expected: FAIL because server/tools are absent.

- [ ] **Step 3: Implement FastMCP adapter**

Use `FastMCP("Equipment Maintenance", stateless_http=True, auth=...)` and six `@mcp.tool` functions. Each function accepts only the typed contract input, constructs the application client call, and returns typed structured JSON. The server turns application errors into safe MCP `isError` content, never a traceback. Build an ASGI `app = mcp.http_app(path="/mcp")` for Horizon.

- [ ] **Step 4: Verify and commit**

Run: `uv run pytest tests/test_tools.py tests/test_server.py -q && uv run ruff check . && uv run mypy src`

Run: `git add src tests && git commit -m "feat: add maintenance MCP tools"`

### Task 5: Add Horizon deployment and cross-repository contract CI

**Files:** Create `prefect.yaml`, `.github/workflows/ci.yml`, `.github/workflows/horizon-smoke.yml`, `README.md`, `tests/test_deployment_contract.py`.

- [ ] **Step 1: Write failing deployment contract test**

```py
def test_horizon_entrypoint_exposes_stateless_mcp_asgi_app() -> None:
    assert load_prefect_entrypoint() == "equipment_maintenance_mcp.server:app"
```

- [ ] **Step 2: Verify it fails**

Run: `uv run pytest tests/test_deployment_contract.py -q`

Expected: FAIL because deployment metadata is absent.

- [ ] **Step 3: Implement deployment/documentation**

Set the Horizon entrypoint to `equipment_maintenance_mcp.server:app`; configure service env variable names but no values. CI runs pytest/ruff/mypy, validates the fixture contract SHA against the released application contract, and fails on drift. A manually approved smoke workflow deploys staging, uses a restricted current token to call `tools/list`, verifies exactly six tools, then revokes/rotates test credentials. README documents local Streamable HTTP run, Horizon env configuration, current/previous token rotation, and explicitly forbids direct DB/NVIDIA/browser credentials.

- [ ] **Step 4: Verify and commit**

Run: `uv run pytest -q && uv run ruff check . && uv run mypy src`

Run: `git add prefect.yaml .github README.md tests && git commit -m "ci: add Horizon MCP deployment checks"`

## Plan Self-Review

- Spec coverage: Tasks 1-2 establish repository/contracts/auth; Tasks 3-4 implement the typed tool boundary; Task 5 covers Horizon and cross-repository compatibility.
- Type consistency: all six names are exact and are contract-validated on both sides.
- Scope: no direct database, NVIDIA, user browser, external client, Graph RAG, or CMMS functionality appears in this repository.
