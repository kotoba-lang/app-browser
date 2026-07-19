import { createHash } from "node:crypto";
import type { ImageBinary } from "./types.js";

const MAX_BINARY_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/** Fetches a single image and returns its binary data with metadata. */
export async function fetchImageBinary(
  imageURL: string,
  userAgent: string,
  timeoutMs: number = 15_000,
): Promise<ImageBinary> {
  const resp = await fetch(imageURL, {
    method: "GET",
    headers: userAgent.trim() ? { "User-Agent": userAgent } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`status ${resp.status}`);
  }

  let contentType = (resp.headers.get("Content-Type") || "").trim();
  if (!contentType) {
    contentType = inferImageMimeTypeFromURL(imageURL);
  }
  // Strip charset params.
  const semiIdx = contentType.indexOf(";");
  if (semiIdx > 0) {
    contentType = contentType.slice(0, semiIdx).trim();
  }
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`not an image: ${contentType}`);
  }

  const arrayBuf = await resp.arrayBuffer();
  const body = Buffer.from(arrayBuf);

  if (body.length === 0) {
    throw new Error("empty body");
  }
  if (body.length > MAX_BINARY_IMAGE_BYTES) {
    throw new Error(`image too large: ${body.length} bytes`);
  }

  const sha256 = createHash("sha256").update(body).digest("hex");
  const dataBase64 = body.toString("base64");

  return {
    url: imageURL,
    'mimeType': contentType,
    sha256,
    'dataBase64': dataBase64,
    'sizeBytes': body.length,
  };
}

function inferImageMimeTypeFromURL(u: string): string {
  const lower = u.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".svg")) return "image/svg+xml";
  if (lower.includes(".avif")) return "image/avif";
  return "image/jpeg";
}
