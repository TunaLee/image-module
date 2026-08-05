import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

const inspection = vi.hoisted(() => ({
  createInspection: vi.fn(),
  getInspection: vi.fn(),
  listRecentInspections: vi.fn(),
}));

vi.mock("../lib/auth", () => auth);
vi.mock("../lib/inspection", () => inspection);

import { GET as getInspections, POST } from "../app/api/inspections/route";
import { GET as getInspection } from "../app/api/inspections/[id]/route";

const user = { id: "17b4b70b-5be6-421f-bc1f-9bcd5c6dfd3b", email: "operator@example.com" };

describe("inspection API routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 404 when the requested inspection is not owned by the current user", async () => {
    auth.getCurrentUser.mockResolvedValue(user);
    inspection.getInspection.mockResolvedValue(null);
    const inspectionId = "0fa4bb47-78a3-4fa0-b685-c1cba89a7b64";

    const response = await getInspection(
      new Request(`http://localhost/api/inspections/${inspectionId}`),
      { params: Promise.resolve({ id: inspectionId }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Inspection not found" });
    expect(inspection.getInspection).toHaveBeenCalledWith(user.id, inspectionId);
  });

  it("returns 404 for a malformed inspection id without querying the database", async () => {
    auth.getCurrentUser.mockResolvedValue(user);

    const response = await getInspection(
      new Request("http://localhost/api/inspections/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Inspection not found" });
    expect(inspection.getInspection).not.toHaveBeenCalled();
  });

  it("rejects visual inspections without a criterion before saving the upload", async () => {
    auth.getCurrentUser.mockResolvedValue(user);
    const form = new FormData();
    form.set("mode", "visual");
    form.set("image", new File(["image"], "equipment.jpg", { type: "image/jpeg" }));

    const response = await POST(
      new Request("http://localhost/api/inspections", { method: "POST", body: form }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A criterion is required for visual inspection" });
    expect(inspection.createInspection).not.toHaveBeenCalled();
  });

  it("returns only the current user's most recent inspection records", async () => {
    auth.getCurrentUser.mockResolvedValue(user);
    inspection.listRecentInspections.mockResolvedValue([{ id: "mine" }]);

    const response = await getInspections();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inspections: [{ id: "mine" }] });
    expect(inspection.listRecentInspections).toHaveBeenCalledWith(user.id);
  });

  it("does not expose database errors while listing inspections", async () => {
    auth.getCurrentUser.mockResolvedValue(user);
    inspection.listRecentInspections.mockRejectedValue(
      new Error("password authentication failed for database"),
    );

    const response = await getInspections();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to load inspections" });
  });

  it("does not expose database errors while loading inspection detail", async () => {
    auth.getCurrentUser.mockResolvedValue(user);
    inspection.getInspection.mockRejectedValue(new Error("SELECT id FROM inspections"));
    const inspectionId = "0fa4bb47-78a3-4fa0-b685-c1cba89a7b64";

    const response = await getInspection(
      new Request(`http://localhost/api/inspections/${inspectionId}`),
      { params: Promise.resolve({ id: inspectionId }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to load inspection" });
  });

  it("does not expose session-store errors while listing inspections", async () => {
    auth.getCurrentUser.mockRejectedValue(new Error("sessions connection string"));

    const response = await getInspections();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to load inspections" });
  });

  it("does not expose session-store errors while creating an inspection", async () => {
    auth.getCurrentUser.mockRejectedValue(new Error("sessions connection string"));

    const response = await POST(
      new Request("http://localhost/api/inspections", { method: "POST" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to create inspection" });
  });

  it("does not expose session-store errors while loading inspection detail", async () => {
    auth.getCurrentUser.mockRejectedValue(new Error("sessions connection string"));
    const inspectionId = "0fa4bb47-78a3-4fa0-b685-c1cba89a7b64";

    const response = await getInspection(
      new Request(`http://localhost/api/inspections/${inspectionId}`),
      { params: Promise.resolve({ id: inspectionId }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to load inspection" });
  });
});
