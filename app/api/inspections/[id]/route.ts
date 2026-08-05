import { z } from "zod";

import { getCurrentUser } from "../../../../lib/auth";
import { getInspection } from "../../../../lib/inspection";

export const runtime = "nodejs";

const inspectionIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return Response.json({ error: "Unable to load inspection" }, { status: 500 });
  }

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!inspectionIdSchema.safeParse(id).success) {
    return Response.json({ error: "Inspection not found" }, { status: 404 });
  }

  try {
    const inspection = await getInspection(user.id, id);
    if (!inspection) {
      return Response.json({ error: "Inspection not found" }, { status: 404 });
    }

    return Response.json({ inspection });
  } catch {
    return Response.json({ error: "Unable to load inspection" }, { status: 500 });
  }
}
