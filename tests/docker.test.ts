import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");

async function readProjectFile(path: string) {
  return readFile(resolve(root, path), "utf8");
}

describe("offline Docker deployment", () => {
  test("defines an app image with a production Next.js build", async () => {
    const dockerfile = await readProjectFile("Dockerfile");

    expect(dockerfile).toContain("npm ci");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain('CMD ["./node_modules/.bin/next", "start"]');
  });

  test("makes the Prisma schema available to npm postinstall", async () => {
    const dockerfile = await readProjectFile("Dockerfile");

    const schemaCopyIndex = dockerfile.indexOf("COPY prisma ./prisma");
    expect(schemaCopyIndex).toBeGreaterThanOrEqual(0);
    expect(schemaCopyIndex).toBeLessThan(dockerfile.indexOf("RUN npm ci"));
  });

  test("runs the app and a persistent PostgreSQL database", async () => {
    const compose = await readProjectFile("compose.yaml");

    expect(compose).toContain("postgres:16-alpine");
    expect(compose).toContain("postgres_data:");
    expect(compose).toContain("uploads_data:");
    expect(compose).toContain("service_completed_successfully");
  });

  test("builds the shared app image only once", async () => {
    const compose = await readProjectFile("compose.yaml");

    expect(compose.match(/^\s+build:/gm)).toHaveLength(1);
  });

  test("keeps local dependencies and secrets out of the build context", async () => {
    const dockerignore = await readProjectFile(".dockerignore");

    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".env*");
    expect(dockerignore).toContain(".next");
    expect(dockerignore).toContain("*.log");
  });
});
