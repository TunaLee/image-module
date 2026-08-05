import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export async function saveUpload(
  file: File,
): Promise<{ imagePath: string; base64: string }> {
  if (!ACCEPTED_MEDIA_TYPES.has(file.type)) {
    throw new UploadValidationError("Only JPEG, PNG, and WebP images are accepted.");
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("Image files must be no larger than 10 MB.");
  }

  let jpegBytes: Buffer;
  try {
    jpegBytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  } catch {
    throw new UploadValidationError("The uploaded image could not be processed.");
  }

  const filename = `${randomUUID()}.jpg`;
  const uploadDirectory = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, filename), jpegBytes, { flag: "wx" });

  return {
    imagePath: `/uploads/${filename}`,
    base64: jpegBytes.toString("base64"),
  };
}
