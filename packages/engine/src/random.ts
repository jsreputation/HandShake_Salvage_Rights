/** Small deterministic PRNG utilities (no Math.random anywhere in the engine). */

export function hashString(input: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts: Array<string | number>): () => number {
  return mulberry32(hashString(parts.join('|')));
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a room code from a random source (defaults to crypto when available). */
export function makeRoomCode(length = 5, random: () => number = defaultRandom): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{4,8}$/.test(code);
}

function defaultRandom(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    g.crypto.getRandomValues(buf);
    return buf[0]! / 4294967296;
  }
  return Math.random();
}

export function randomId(length = 16): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(defaultRandom() * alphabet.length)];
  return out;
}
