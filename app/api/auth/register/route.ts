import { z } from "zod";

import { createSession, hashPassword } from "../../../../lib/auth";
import { createUser } from "../../../../lib/db";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
});

function invalidCredentialsResponse(): Response {
  return Response.json({ error: "Invalid email or password" }, { status: 400 });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
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

  try {
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);
    await createSession(user.id);

    return Response.json({ user: { id: user.id, email: user.email } }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return Response.json({ error: "Email is already registered" }, { status: 409 });
    }

    console.error("Registration failed", error);
    return Response.json({ error: "Unable to register" }, { status: 500 });
  }
}
