import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  captchaEnabled,
  clearUsedChallenges,
  issueChallenge,
  verifyCaptcha,
} from "./captcha";

// Solve a challenge the way the client would, returning the base64 payload the
// server expects. Difficulty is kept tiny in tests so the brute force is instant.
const solveChallenge = (
  challenge: ReturnType<typeof issueChallenge>,
  overrides: Partial<{
    salt: string;
    challenge: string;
    expires: number;
    signature: string;
    number: number;
  }> = {},
): string => {
  let answer = 0;
  for (let n = 0; n <= challenge.maxnumber; n++) {
    if (
      createHash("sha256").update(`${challenge.salt}${n}`).digest("hex") ===
      challenge.challenge
    ) {
      answer = n;
      break;
    }
  }
  const payload = {
    salt: challenge.salt,
    challenge: challenge.challenge,
    expires: challenge.expires,
    signature: challenge.signature,
    number: answer,
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
};

describe("Captcha Service", () => {
  const original = {
    enabled: process.env.CAPTCHA_ENABLED,
    difficulty: process.env.CAPTCHA_DIFFICULTY,
  };

  beforeEach(() => {
    process.env.CAPTCHA_ENABLED = "true";
    process.env.CAPTCHA_DIFFICULTY = "2000";
    clearUsedChallenges();
  });

  afterEach(() => {
    if (original.enabled === undefined) delete process.env.CAPTCHA_ENABLED;
    else process.env.CAPTCHA_ENABLED = original.enabled;
    if (original.difficulty === undefined)
      delete process.env.CAPTCHA_DIFFICULTY;
    else process.env.CAPTCHA_DIFFICULTY = original.difficulty;
    clearUsedChallenges();
  });

  describe("when disabled", () => {
    test("captchaEnabled reflects the flag", () => {
      delete process.env.CAPTCHA_ENABLED;
      expect(captchaEnabled()).toBe(false);
    });

    test("verifyCaptcha passes through any payload, even null", () => {
      delete process.env.CAPTCHA_ENABLED;
      expect(verifyCaptcha(null)).toBe(true);
      expect(verifyCaptcha("garbage")).toBe(true);
    });
  });

  describe("when enabled", () => {
    test("captchaEnabled is true", () => {
      expect(captchaEnabled()).toBe(true);
    });

    test("accepts a correctly solved challenge", () => {
      const challenge = issueChallenge();
      expect(verifyCaptcha(solveChallenge(challenge))).toBe(true);
    });

    test("rejects a null or malformed payload", () => {
      expect(verifyCaptcha(null)).toBe(false);
      expect(verifyCaptcha("")).toBe(false);
      expect(verifyCaptcha("not-base64-json")).toBe(false);
      expect(verifyCaptcha(Buffer.from("{}").toString("base64"))).toBe(false);
    });

    test("rejects a wrong proof-of-work answer", () => {
      const challenge = issueChallenge();
      const bad = solveChallenge(challenge, {
        number: challenge.maxnumber + 7,
      });
      expect(verifyCaptcha(bad)).toBe(false);
    });

    test("rejects a tampered challenge (signature mismatch)", () => {
      const challenge = issueChallenge();
      // Flip the target hash without re-signing.
      const tampered = solveChallenge(challenge, {
        challenge: `${challenge.challenge.slice(0, -1)}0`,
      });
      expect(verifyCaptcha(tampered)).toBe(false);
    });

    test("rejects a tampered expiry (signature mismatch)", () => {
      const challenge = issueChallenge();
      const tampered = solveChallenge(challenge, {
        expires: challenge.expires + 60_000,
      });
      expect(verifyCaptcha(tampered)).toBe(false);
    });

    test("rejects a past-dated (expired) payload", () => {
      // Expiry is checked before the signature, so a past `expires` is rejected
      // outright regardless of the rest of the payload.
      const challenge = issueChallenge();
      const expiredPayload = solveChallenge(challenge, {
        expires: Date.now() - 1000,
      });
      expect(verifyCaptcha(expiredPayload)).toBe(false);
    });

    test("rejects replaying a previously accepted solution", () => {
      const challenge = issueChallenge();
      const payload = solveChallenge(challenge);
      expect(verifyCaptcha(payload)).toBe(true);
      // Same signature can't be spent twice.
      expect(verifyCaptcha(payload)).toBe(false);
    });

    test("issued challenges are unique per call", () => {
      const a = issueChallenge();
      const b = issueChallenge();
      expect(a.salt).not.toBe(b.salt);
      expect(a.signature).not.toBe(b.signature);
    });
  });
});
