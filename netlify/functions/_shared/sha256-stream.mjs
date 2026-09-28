/**
 * netlify/functions/_shared/sha256-stream.mjs
 *
 * Incremental SHA-256 in plain JavaScript, for the artwork upload page:
 * Web Crypto's digest() needs the whole input at once, and a 2 GB file can't
 * be held in memory. The page embeds createSha256.toString(), so this must
 * stay ONE self-contained function (no imports, no outside names).
 * The tests check it against node:crypto across chunk boundaries.
 */
export function createSha256() {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const block = new Uint8Array(64);
  let used = 0;          // bytes waiting in `block`
  let total = 0;         // bytes hashed so far

  function compress(buf, off) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }

  return {
    /** @param {Uint8Array} data */
    update(data) {
      let i = 0;
      total += data.length;
      if (used) {
        const take = Math.min(64 - used, data.length);
        block.set(data.subarray(0, take), used);
        used += take; i = take;
        if (used < 64) return this;
        compress(block, 0); used = 0;
      }
      for (; i + 64 <= data.length; i += 64) compress(data, i);
      if (i < data.length) { block.set(data.subarray(i), 0); used = data.length - i; }
      return this;
    },
    /** @returns {string} lower-case hex; the hash can't be updated afterwards */
    digestHex() {
      const bits = total * 8;
      const pad = new Uint8Array(((used < 56 ? 56 : 120) - used) + 8);
      pad[0] = 0x80;
      const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
      const n = pad.length;
      pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
      pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
      const t = total;
      this.update(pad);
      total = t;
      let out = '';
      for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
      return out;
    },
  };
}
