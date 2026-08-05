import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NVIDIA_API_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});

export function getServerEnv(source = process.env) {
  return serverEnvSchema.parse(source);
}
