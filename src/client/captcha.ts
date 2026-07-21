// First-party proof-of-work captcha solver. Standalone, zero-dependency bundle
// (no Preact / no importmap) loaded only on the login page when CAPTCHA_ENABLED is
// on. It reads the challenge the server embedded in the mount element, brute-forces
// the answer, and writes the solved payload into a hidden form field.
//
// The field/attribute names below MUST match src/server/services/captcha.ts. The
// client cannot import that module (it pulls in node:crypto), so the literals are
// duplicated here; a test cross-checks a client-produced payload against the server
// verifier to catch drift.

const SOLUTION_FIELD = "captcha_solution";
// Yield to the event loop every N hashes so a large search never freezes the tab.
const YIELD_EVERY = 5000;

interface Challenge {
  salt: string;
  challenge: string;
  expires: number;
  maxnumber: number;
  signature: string;
}

// --- Minimal synchronous SHA-256 -------------------------------------------------
// Self-authored (no npm dep). Returns lowercase hex, matching Node's
// createHash("sha256") for UTF-8 input, which the server relies on to verify.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
const toHex8 = (x: number): string => (x >>> 0).toString(16).padStart(8, "0");

export const sha256hex = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const pad = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + pad + 8;

  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a15 = w[i - 15];
      const a2 = w[i - 2];
      const s0 = rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3);
      const s1 = rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return (
    toHex8(h0) +
    toHex8(h1) +
    toHex8(h2) +
    toHex8(h3) +
    toHex8(h4) +
    toHex8(h5) +
    toHex8(h6) +
    toHex8(h7)
  );
};

// --- Solver ----------------------------------------------------------------------

const readChallenge = (mount: HTMLElement): Challenge | null => {
  const { salt, challenge, expires, maxnumber, signature } = mount.dataset;
  if (!salt || !challenge || !expires || !maxnumber || !signature) return null;
  return {
    salt,
    challenge,
    expires: Number(expires),
    maxnumber: Number(maxnumber),
    signature,
  };
};

export const solve = async (c: Challenge): Promise<number | null> => {
  for (let n = 0; n <= c.maxnumber; n++) {
    if (sha256hex(`${c.salt}${n}`) === c.challenge) return n;
    if (n % YIELD_EVERY === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return null;
};

const encodePayload = (c: Challenge, n: number): string =>
  btoa(
    JSON.stringify({
      salt: c.salt,
      challenge: c.challenge,
      expires: c.expires,
      signature: c.signature,
      number: n,
    }),
  );

export const init = async (): Promise<void> => {
  const mount = document.querySelector<HTMLElement>("[data-captcha]");
  if (!mount) return;

  const input = document.querySelector<HTMLInputElement>(
    `input[name="${SOLUTION_FIELD}"]`,
  );
  if (!input) return;

  const challenge = readChallenge(mount);
  if (!challenge) return;

  const status = mount.querySelector<HTMLElement>(".captcha-status");
  const form = mount.closest("form");

  // If the user submits before the proof is ready, hold the submit and replay it
  // once solved — so a fast typist never trips the server-side check.
  let solved = false;
  let submitPending = false;
  form?.addEventListener("submit", (event) => {
    if (!solved) {
      event.preventDefault();
      submitPending = true;
    }
  });

  const answer = await solve(challenge);
  if (answer === null) {
    // Couldn't solve (e.g. tampered challenge) — leave the field empty; the server
    // rejects and re-renders a fresh challenge.
    if (status) status.textContent = "Verification unavailable — please retry.";
    return;
  }

  input.value = encodePayload(challenge, answer);
  solved = true;
  if (status) status.textContent = "Verified.";
  if (submitPending) form?.requestSubmit();
};

// Auto-run when loaded as the standalone bundle. Harmless in tests (no mount → no-op)
// so specs can set up a fixture and call init() themselves.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void init();
    });
  } else {
    void init();
  }
}
