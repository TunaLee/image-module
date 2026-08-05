import { z } from "zod";

import { createSession, verifyPassword } from "../../../../lib/auth";
import { findUserByEmail } from "../../../../lib/db";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
});

const DUMMY_PASSWORD_HASH =
  "nXguPEnEZVaACMxnXWzm2Q:4Si0BjsVOix7WgzUyDYuUBQBDY2drtS-6qhIrtcXCH0IEbUEiUC3w8KpX5QwaNFTiws5TUywZz43Wcv6W1o9zQ";

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
  const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const isPasswordValid = await verifyPassword(password, passwordHash);

  if (!user || !isPasswordValid) {
    return invalidCredentialsResponse();
  }

  await createSession(user.id);
  return Response.json({ user: { id: user.id, email: user.email } });
}
