import sharp from 'sharp';

/**
 * Perceptual hash (pHash): 32×32 grayscale → 2D DCT → top-left 8×8 (excluding DC) → median threshold.
 * Returns a 64-bit hash as 16 hex chars. Robust to resizing, compression and small colour changes.
 */

const N = 32;
const COS = (() => {
  const t: number[][] = [];
  for (let u = 0; u < N; u++) {
    t[u] = [];
    for (let x = 0; x < N; x++) t[u]![x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  }
  return t;
})();

export async function phash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer, { failOn: 'none' }).rotate().resize(N, N, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const px: number[][] = [];
  for (let y = 0; y < N; y++) {
    px[y] = [];
    for (let x = 0; x < N; x++) px[y]![x] = data[y * N + x]!;
  }
  // 2D DCT (only the 8×8 low-frequency block is needed).
  const dct: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        const cy = COS[u]![y]!;
        const row = px[y]!;
        for (let x = 0; x < N; x++) sum += cy * COS[v]![x]! * row[x]!;
      }
      dct.push(sum);
    }
  }
  const ac = dct.slice(1);
  const sorted = [...ac].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  let bits = '';
  for (const v of dct) bits += v > med ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export async function imageMeta(buffer: Buffer): Promise<{ width: number | null; height: number | null }> {
  const m = await sharp(buffer, { failOn: 'none' }).metadata();
  return { width: m.width ?? null, height: m.height ?? null };
}

/** Downscaled JPEG for sending to vision models (keeps tokens and latency low). */
export async function visionThumbnail(buffer: Buffer, max = 1024): Promise<Buffer> {
  return sharp(buffer, { failOn: 'none' }).rotate().resize(max, max, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}
