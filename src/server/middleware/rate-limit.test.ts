import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createBunRequest } from "../test-utils/bun-request";
import { setIpSource } from "./client-ip";
import { clearRateLimitLog, rateLimit } from "./rate-limit";

const url = "http://localhost:3000/login";

const request = (headers: Record<string, string> = {}) =>
  createBunRequest(url, { method: "POST", headers });

/** A stand-in for `server.requestIP` returning a fixed socket address. */
const socketAt = (address: string) => ({
  requestIP: () => ({ address, port: 0, family: "IPv4" as const }),
});

describe("rateLimit", () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    clearRateLimitLog();
    process.env.TRUST_PROXY = originalTrustProxy;
  });

  afterEach(() => {
    setIpSource(null);
  });

  afterAll(() => {
    process.env.TRUST_PROXY = originalTrustProxy;
  });

  test("blocks after the limit and sends Retry-After", () => {
    expect(rateLimit(request(), "auth", 2, 60_000)).toBeNull();
    expect(rateLimit(request(), "auth", 2, 60_000)).toBeNull();

    const blocked = rateLimit(request(), "auth", 2, 60_000);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  // The whole point of the keying change: x-forwarded-for is client-controlled,
  // so without TRUST_PROXY a fresh header value per request must NOT buy a
  // fresh bucket.
  test("ignores x-forwarded-for when the proxy is not trusted", () => {
    expect(
      rateLimit(request({ "x-forwarded-for": "1.1.1.1" }), "auth", 1, 60_000),
    ).toBeNull();

    const blocked = rateLimit(
      request({ "x-forwarded-for": "2.2.2.2" }),
      "auth",
      1,
      60_000,
    );
    expect(blocked?.status).toBe(429);
  });

  test("keys on the socket address when one is available", () => {
    setIpSource(socketAt("10.0.0.1"));
    expect(rateLimit(request(), "auth", 1, 60_000)).toBeNull();
    expect(rateLimit(request(), "auth", 1, 60_000)?.status).toBe(429);

    // A different socket is a different client, over the same limit.
    setIpSource(socketAt("10.0.0.2"));
    expect(rateLimit(request(), "auth", 1, 60_000)).toBeNull();
  });

  describe("with TRUST_PROXY=true", () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = "true";
    });

    test("keys on the last x-forwarded-for entry only", () => {
      // The proxy appends the real client last; everything before it arrived
      // in the client's own request. Varying the spoofable prefix must not
      // escape the bucket.
      expect(
        rateLimit(
          request({ "x-forwarded-for": "9.9.9.9, 5.5.5.5" }),
          "auth",
          1,
          60_000,
        ),
      ).toBeNull();

      const blocked = rateLimit(
        request({ "x-forwarded-for": "8.8.8.8, 5.5.5.5" }),
        "auth",
        1,
        60_000,
      );
      expect(blocked?.status).toBe(429);
    });

    test("distinct clients behind the proxy get distinct buckets", () => {
      expect(
        rateLimit(request({ "x-forwarded-for": "5.5.5.5" }), "auth", 1, 60_000),
      ).toBeNull();
      expect(
        rateLimit(request({ "x-forwarded-for": "6.6.6.6" }), "auth", 1, 60_000),
      ).toBeNull();
    });

    test("falls back to the socket address when the header is absent", () => {
      setIpSource(socketAt("10.0.0.3"));
      expect(rateLimit(request(), "auth", 1, 60_000)).toBeNull();
      expect(rateLimit(request(), "auth", 1, 60_000)?.status).toBe(429);
    });

    test("a header with an empty last hop falls back to the socket", () => {
      setIpSource(socketAt("10.0.0.4"));
      // A trailing comma leaves the proxy-added slot blank — an empty string
      // must not become its own shared bucket key.
      expect(
        rateLimit(
          request({ "x-forwarded-for": "7.7.7.7, " }),
          "auth",
          1,
          60_000,
        ),
      ).toBeNull();
      expect(
        rateLimit(
          request({ "x-forwarded-for": "6.6.6.6, " }),
          "auth",
          1,
          60_000,
        )?.status,
      ).toBe(429);
    });
  });

  // Keyed on the address alone, every limiter in the app shared one counter:
  // a handful of `/api/*` reads left the next `/login` POST from that address
  // already over the auth limiter's 5, which made five cheap unauthenticated
  // GETs enough to lock a shared NAT out of signing in.
  describe("bucket isolation", () => {
    test("API reads do not spend the auth budget", () => {
      for (let i = 0; i < 10; i++) {
        expect(rateLimit(request(), "api-read", 60, 60_000)).toBeNull();
      }

      expect(rateLimit(request(), "auth", 5, 60_000)).toBeNull();
    });

    test("API reads do not spend the API write budget", () => {
      for (let i = 0; i < 60; i++) {
        expect(rateLimit(request(), "api-read", 60, 60_000)).toBeNull();
      }

      expect(rateLimit(request(), "api-write", 20, 60_000)).toBeNull();
    });

    test("auth attempts do not spend the API budget", () => {
      expect(rateLimit(request(), "auth", 1, 60_000)).toBeNull();
      expect(rateLimit(request(), "auth", 1, 60_000)?.status).toBe(429);

      expect(rateLimit(request(), "api-read", 60, 60_000)).toBeNull();
    });

    // The same address in two buckets is two counters, but one address per
    // bucket is still one counter — exhausting a bucket must still 429.
    test("a bucket still blocks on its own traffic", () => {
      expect(rateLimit(request(), "api-write", 1, 60_000)).toBeNull();
      expect(rateLimit(request(), "api-write", 1, 60_000)?.status).toBe(429);
    });
  });
});
