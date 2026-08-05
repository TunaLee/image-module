import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  clearSession: vi.fn(),
  createSession: vi.fn(),
  getCurrentUser: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

const db = vi.hoisted(() => ({
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
}));

vi.mock("../lib/auth", () => auth);
vi.mock("../lib/db", () => db);

import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { POST as register } from "../app/api/auth/register/route";
import { GET as session } from "../app/api/auth/session/route";

function credentialsRequest(url: string, credentials: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
}

describe("authentication API routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a short registration password without creating an account", async () => {
    const response = await register(
      credentialsRequest("http://localhost/api/auth/register", {
        email: "operator@example.com",
        password: "short",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid email or password" });
    expect(db.createUser).not.toHaveBeenCalled();
  });

  it("normalizes credentials, starts a session, and returns the registered user", async () => {
    auth.hashPassword.mockResolvedValue("password-hash");
    db.createUser.mockResolvedValue({
      id: "2e504e10-12e2-4f47-b4ea-2f375fbd5d79",
      email: "operator@example.com",
      passwordHash: "password-hash",
    });

    const response = await register(
      credentialsRequest("http://localhost/api/auth/register", {
        email: " Operator@Example.COM ",
        password: "secure-password",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      user: { id: "2e504e10-12e2-4f47-b4ea-2f375fbd5d79", email: "operator@example.com" },
    });
    expect(auth.hashPassword).toHaveBeenCalledWith("secure-password");
    expect(db.createUser).toHaveBeenCalledWith("operator@example.com", "password-hash");
    expect(auth.createSession).toHaveBeenCalledWith("2e504e10-12e2-4f47-b4ea-2f375fbd5d79");
  });

  it("returns conflict when registration encounters a duplicate email", async () => {
    auth.hashPassword.mockResolvedValue("password-hash");
    db.createUser.mockRejectedValue({ code: "23505" });

    const response = await register(
      credentialsRequest("http://localhost/api/auth/register", {
        email: "operator@example.com",
        password: "secure-password",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Email is already registered" });
  });

  it("uses one invalid-credentials response when the login account is absent", async () => {
    db.findUserByEmail.mockResolvedValue(null);

    const response = await login(
      credentialsRequest("http://localhost/api/auth/login", {
        email: "unknown@example.com",
        password: "secure-password",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid email or password" });
    expect(auth.verifyPassword).not.toHaveBeenCalled();
  });

  it("starts a session for valid login credentials", async () => {
    db.findUserByEmail.mockResolvedValue({
      id: "2e504e10-12e2-4f47-b4ea-2f375fbd5d79",
      email: "operator@example.com",
      passwordHash: "password-hash",
    });
    auth.verifyPassword.mockResolvedValue(true);

    const response = await login(
      credentialsRequest("http://localhost/api/auth/login", {
        email: "operator@example.com",
        password: "secure-password",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "2e504e10-12e2-4f47-b4ea-2f375fbd5d79", email: "operator@example.com" },
    });
    expect(auth.createSession).toHaveBeenCalledWith("2e504e10-12e2-4f47-b4ea-2f375fbd5d79");
  });

  it("clears the current session during logout", async () => {
    const response = await logout(new Request("http://localhost/api/auth/logout", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(auth.clearSession).toHaveBeenCalledOnce();
  });

  it("returns unauthorized when no current session exists", async () => {
    auth.getCurrentUser.mockResolvedValue(null);

    const response = await session(new Request("http://localhost/api/auth/session"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the current user for a valid session", async () => {
    auth.getCurrentUser.mockResolvedValue({
      id: "2e504e10-12e2-4f47-b4ea-2f375fbd5d79",
      email: "operator@example.com",
    });

    const response = await session(new Request("http://localhost/api/auth/session"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: "2e504e10-12e2-4f47-b4ea-2f375fbd5d79", email: "operator@example.com" },
    });
  });
});
