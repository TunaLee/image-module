import { getCurrentUser } from "../../../../lib/auth";

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json({ user });
}
