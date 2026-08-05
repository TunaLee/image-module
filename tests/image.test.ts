import { File as NodeFile } from "node:buffer";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { saveUpload, UploadValidationError } from "../lib/image";

const createdFiles: string[] = [];

afterEach(async () => {
  await Promise.all(createdFiles.splice(0).map((file) => rm(file, { force: true })));
});

describe("saveUpload", () => {
  it("persists an accepted image as a UUID-named JPEG and returns its base64", async () => {
    const png = await sharp({
      create: { width: 2, height: 1, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const file = new NodeFile([png], "equipment.png", { type: "image/png" });

    const saved = await saveUpload(file as unknown as File);
    const filename = saved.imagePath.replace("/uploads/", "");
    const localPath = path.join(process.cwd(), "public", "uploads", filename);
    createdFiles.push(localPath);

    expect(saved.imagePath).toMatch(/^\/uploads\/[0-9a-f-]{36}\.jpg$/);
    expect(saved.base64).toBe(Buffer.from(await readFile(localPath)).toString("base64"));
    await expect(access(localPath)).resolves.toBeUndefined();
  });

  it("rejects an unsupported upload media type before persisting it", async () => {
    const file = new NodeFile(["not an image"], "notes.gif", { type: "image/gif" });

    await expect(saveUpload(file as unknown as File)).rejects.toBeInstanceOf(
      UploadValidationError,
    );
  });
});
