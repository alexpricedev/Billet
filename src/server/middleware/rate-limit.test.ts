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
    expect(rateLimit(request(), 2, 60_000)).toBeNull();
    expect(rateLimit(request(), 2, 60_000)).toBeNull();

    const blocked = rateLimit(request(), 2, 60_000);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  // The whole point of the keying change: x-forwarded-for is client-controlled,
  // so without TRUST_PROXY a fresh header value per request must NOT buy a
  // fresh bucket.
  test("ignores x-forwarded-for when the proxy is not trusted", () => {
    expect(
      rateLimit(request({ "x-forwarded-for": "1.1.1.1" }), 1, 60_000),
    ).toBeNull();

    const blocked = rateLimit(
      request({ "x-forwarded-for": "2.2.2.2" }),
      1,
      60_000,
    );
    expect(blocked?.status).toBe(429);
  });

  test("keys on the socket address when one is available", () => {
    setIpSource(socketAt("10.0.0.1"));
    expect(rateLimit(request(), 1, 60_000)).toBeNull();
    expect(rateLimit(request(), 1, 60_000)?.status).toBe(429);

    // A different socket is a different client, over the same limit.
    setIpSource(socketAt("10.0.0.2"));
    expect(rateLimit(request(), 1, 60_000)).toBeNull();
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
          1,
          60_000,
        ),
      ).toBeNull();

      const blocked = rateLimit(
        request({ "x-forwarded-for": "8.8.8.8, 5.5.5.5" }),
        1,
        60_000,
      );
      expect(blocked?.status).toBe(429);
    });

    test("distinct clients behind the proxy get distinct buckets", () => {
      expect(
        rateLimit(request({ "x-forwarded-for": "5.5.5.5" }), 1, 60_000),
      ).toBeNull();
      expect(
        rateLimit(request({ "x-forwarded-for": "6.6.6.6" }), 1, 60_000),
      ).toBeNull();
    });

    test("falls back to the socket address when the header is absent", () => {
      setIpSource(socketAt("10.0.0.3"));
      expect(rateLimit(request(), 1, 60_000)).toBeNull();
      expect(rateLimit(request(), 1, 60_000)?.status).toBe(429);
    });

    test("a header with an empty last hop falls back to the socket", () => {
      setIpSource(socketAt("10.0.0.4"));
      // A trailing comma leaves the proxy-added slot blank — an empty string
      // must not become its own shared bucket key.
      expect(
        rateLimit(request({ "x-forwarded-for": "7.7.7.7, " }), 1, 60_000),
      ).toBeNull();
      expect(
        rateLimit(request({ "x-forwarded-for": "6.6.6.6, " }), 1, 60_000)
          ?.status,
      ).toBe(429);
    });
  });
});
