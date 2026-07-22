import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearUsedChallenges,
  issueChallenge,
  verifyCaptcha,
} from "../server/services/captcha";
import { init, sha256hex, solve } from "./captcha";

const mountChallenge = (challenge: ReturnType<typeof issueChallenge>): void => {
  const form = document.createElement("form");

  const mount = document.createElement("div");
  mount.setAttribute("data-captcha", "");
  mount.dataset.salt = challenge.salt;
  mount.dataset.challenge = challenge.challenge;
  mount.dataset.expires = String(challenge.expires);
  mount.dataset.maxnumber = String(challenge.maxnumber);
  mount.dataset.signature = challenge.signature;

  const status = document.createElement("span");
  status.className = "captcha-status";
  mount.appendChild(status);

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "captcha_solution";

  form.appendChild(mount);
  form.appendChild(input);
  document.body.appendChild(form);
};

describe("captcha client solver", () => {
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
    document.body.innerHTML = "";
    if (original.enabled === undefined) delete process.env.CAPTCHA_ENABLED;
    else process.env.CAPTCHA_ENABLED = original.enabled;
    if (original.difficulty === undefined)
      delete process.env.CAPTCHA_DIFFICULTY;
    else process.env.CAPTCHA_DIFFICULTY = original.difficulty;
    clearUsedChallenges();
  });

  test("sha256hex matches known NIST vectors (parity with node:crypto)", () => {
    expect(sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("solve finds the answer for a real challenge", async () => {
    const challenge = issueChallenge();
    const answer = await solve(challenge);
    expect(answer).not.toBeNull();
    expect(sha256hex(`${challenge.salt}${answer}`)).toBe(challenge.challenge);
  });

  test("init fills the hidden field with a server-verifiable payload", async () => {
    const challenge = issueChallenge();
    mountChallenge(challenge);

    await init();

    const input = document.querySelector<HTMLInputElement>(
      'input[name="captcha_solution"]',
    );
    expect(input?.value).toBeTruthy();
    // The end-to-end proof: the client-produced payload verifies server-side,
    // which can only pass if the hand-written SHA-256 matches node:crypto.
    expect(verifyCaptcha(input?.value ?? null)).toBe(true);
  });

  test("init is a no-op when there is no mount", async () => {
    await init();
    expect(document.body.innerHTML).toBe("");
  });
});
