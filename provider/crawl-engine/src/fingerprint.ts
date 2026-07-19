import { createHash } from "node:crypto";

/**
 * Computes SHA-256 hash and 64-bit SimHash from title + text content.
 * Returns [hash, simHash] where simHash is a hex string of the 64-bit value.
 */
export function contentFingerprints(
  title: string,
  textContent: string,
): [hash: string, simHash: string] {
  const base = (title + " " + textContent).trim().toLowerCase();
  if (!base) {
    return ["", "0"];
  }

  const fields = base.split(/\s+/).filter(Boolean);
  if (fields.length === 0) {
    return ["", "0"];
  }

  const joined = fields.join(" ");
  const hash = createHash("sha256").update(joined, "utf8").digest("hex");

  // SimHash: 64-bit locality-sensitive hash.
  const tokens = fields.length > 4096 ? fields.slice(0, 4096) : fields;
  const weights = new Array<number>(64).fill(0);

  for (const token of tokens) {
    if (!token) continue;
    const h = createHash("sha256").update(token, "utf8").digest();
    // Extract first 8 bytes as a 64-bit value (BigInt).
    let v = BigInt(0);
    for (let i = 0; i < 8; i++) {
      v = (v << BigInt(8)) | BigInt(h[i]);
    }
    for (let bit = 0; bit < 64; bit++) {
      if ((v >> BigInt(bit)) & BigInt(1)) {
        weights[bit]++;
      } else {
        weights[bit]--;
      }
    }
  }

  let simHash = BigInt(0);
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) {
      simHash |= BigInt(1) << BigInt(bit);
    }
  }

  return [hash, simHash.toString()];
}
