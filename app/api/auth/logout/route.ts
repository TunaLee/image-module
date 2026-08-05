import { clearSession } from "../../../../lib/auth";

export async function POST(): Promise<Response> {
  await clearSession();
  return Response.json({ ok: true });
}
