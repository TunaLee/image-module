import { z } from "zod";

import { getCurrentUser } from "../../../lib/auth";
import { createInspection, listRecentInspections } from "../../../lib/inspection";
import { UploadValidationError } from "../../../lib/image";

export const runtime = "nodejs";

const modeSchema = z.enum(["ocr", "visual", "both"]);

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(): Promise<Response> {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return Response.json({ error: "Unable to load inspections" }, { status: 500 });
  }

  if (!user) return unauthorized();

  try {
    const inspections = await listRecentInspections(user.id);
    return Response.json({ inspections });
  } catch {
    return Response.json({ error: "Unable to load inspections" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return Response.json({ error: "Unable to create inspection" }, { status: 500 });
  }

  if (!user) return unauthorized();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "A multipart inspection request is required" }, { status: 400 });
  }

  const mode = modeSchema.safeParse(formData.get("mode"));
  const image = formData.get("image");
  const criterionValue = formData.get("criterion");
  const criterion = typeof criterionValue === "string" ? criterionValue.trim() : "";

  if (!mode.success || !(image instanceof File)) {
    return Response.json({ error: "Image and inspection mode are required" }, { status: 400 });
  }

  if ((mode.data === "visual" || mode.data === "both") && !criterion) {
    return Response.json(
      { error: "A criterion is required for visual inspection" },
      { status: 400 },
    );
  }

  try {
    const inspection = await createInspection(user.id, {
      file: image,
      mode: mode.data,
      criterion: criterion || null,
    });
    return Response.json({ inspection }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ error: "Unable to create inspection" }, { status: 500 });
  }
}
