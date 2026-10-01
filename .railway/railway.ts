// Railway Infrastructure as Code: the six build and deploy settings that used to
// live only in the service's Settings tab, plus the Postgres link and the
// environment contract. Railway's CLI evaluates this file — nothing here applies
// on `git push`:
//
//   railway link                 # once, to point the CLI at your project
//   railway config plan          # read the diff
//   railway config apply         # apply it
//
// Needs Railway CLI >= 5.42.1; the SDK refuses to evaluate under anything older.
//
// This replaces `railway.json`, which Railway has retired — a new service can no
// longer opt into it, and existing ones stop reading it on 2026-12-01. There is
// nothing to migrate: the file below is hand-written, not the output of
// `railway config migrate` (which drops `builder` and the restart policy).
import { defineRailway, postgres, preserve, project, service } from "railway/iac";

// Scopes deletion to the resources this file owns. Without it, a project holding
// several unrelated apps and one shared Postgres would read every service it
// *doesn't* find here as a service to delete.
export const partial = "billet";

export default defineRailway(() => {
  const db = postgres("Postgres");

  const app = service("billet", {
    // `builder` and the restart policy have no intent-layer shorthand, so they go
    // in the raw `build` / `deploy` buckets. Everything else uses the shorthand.
    build: { builder: "RAILPACK", buildCommand: "bun install && bun run build" },
    start: "bun run start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    // Only the retry cap. `restartPolicyType: "ON_FAILURE"` is Railway's default
    // already, and declaring it anyway produced a plan that never converged:
    // apply reported success, the value read back as null, and the next plan
    // proposed the same change again. The cap applies and stays applied — it is
    // the only part that differs from the default (10).
    deploy: { restartPolicyMaxRetries: 3 },

    // No `source`. A fork's GitHub slug isn't knowable from here, and a service
    // declared without one emits no source at all — so this file never fights the
    // repo connection you made in the dashboard.

    // Every variable the server reads is listed, because a variable this file
    // omits is a variable Railway may remove. The ones you own are `preserve()`:
    // declared here, valued on Railway, never written into source.
    env: {
      // Set by the Postgres plugin above, wired by reference rather than copied.
      DATABASE_URL: db.env.DATABASE_URL,

      // `preserve()`, not `{ generator: "secret(32)" }`. Railway's generators do
      // not do what the name suggests here: unsealed, the literal string
      // "secret(32)" is stored and served as the value — a publicly known pepper
      // protecting every session token. Sealed, it cannot be read back, so every
      // plan proposes it again and `railway config plan` never exits clean. Set
      // it once by hand: `bun run generate:pepper`.
      CRYPTO_PEPPER: preserve(),

      // Railway terminates TLS and rewrites x-forwarded-for itself, which is the
      // one condition under which trusting the header is safe. See
      // src/server/middleware/client-ip.ts.
      TRUST_PROXY: "true",

      // Required — the server exits at boot without these, so they carry starter
      // defaults rather than `preserve()`: an apply should leave a service that
      // boots, not one that crash-loops on a variable nobody mentioned.
      // `${{RAILWAY_PUBLIC_DOMAIN}}` is resolved by Railway at deploy time, which
      // is what breaks the chicken-and-egg — APP_URL needs the domain, and the
      // domain doesn't exist until the service does.
      APP_NAME: "Billet",
      APP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      EMAIL_PROVIDER: "console",
      FROM_EMAIL: "noreply@example.com",
      FROM_NAME: "Billet",
      RESEND_API_KEY: preserve(),

      // Optional — each one changes behaviour only when set.
      REPLY_TO_EMAIL: preserve(),
      SITE_URL: preserve(),
      ALLOW_INDEXING: preserve(),
      AUTH_MODE: preserve(),
      CAPTCHA_ENABLED: preserve(),
      CAPTCHA_DIFFICULTY: preserve(),
      TEAMS_ENABLED: preserve(),
      SECURITY_CONTACT: preserve(),
      SESSION_COOKIE_NAME: preserve(),
      MAINTENANCE_MODE: preserve(),
      MAINTENANCE_RETRY_AFTER: preserve(),

      // PORT is deliberately absent: Railway sets it on the deployment itself.
    },
  });

  return project("billet", { resources: [app, db] });
});
