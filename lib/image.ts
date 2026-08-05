import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const ACCEPTED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp"]);

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export async function saveUpload(
  file: File,
): Promise<{ imagePath: string; base64: string }> {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("Image files must be no larger than 10 MB.");
  }

  let jpegBytes: Buffer;
  try {
    const sourceBytes = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(sourceBytes, { limitInputPixels: false }).metadata();
    const frameCount = metadata.pages ?? 1;
    const pixelCount = (metadata.width ?? 0) * (metadata.height ?? 0) * frameCount;

    if (
      !metadata.format ||
      !ACCEPTED_IMAGE_FORMATS.has(metadata.format) ||
      !Number.isSafeInteger(pixelCount) ||
      pixelCount <= 0 ||
      pixelCount > MAX_IMAGE_PIXELS
    ) {
      throw new UploadValidationError("Only JPEG, PNG, and WebP images are accepted.");
    }

    jpegBytes = await sharp(sourceBytes, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw error;
    }

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
