import { z } from "zod";

import { createSession, verifyPassword } from "../../../../lib/auth";
import { findUserByEmail } from "../../../../lib/db";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
});

function invalidCredentialsResponse(): Response {
  return Response.json({ error: "Invalid email or password" }, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return invalidCredentialsResponse();
  }

  const parsed = credentialsSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidCredentialsResponse();
  }

  const { email, password } = parsed.data;
  const user = await findUserByEmail(email);

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return invalidCredentialsResponse();
  }

  await createSession(user.id);
  return Response.json({ user: { id: user.id, email: user.email } });
}
