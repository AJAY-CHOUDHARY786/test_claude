import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv, EnvError } from "../app/lib/env.server.ts";

const valid = {
  SHOPIFY_API_KEY: "key123",
  SHOPIFY_API_SECRET: "supersecretvalue",
  SCOPES: "read_products, write_products",
  SHOPIFY_APP_URL: "https://example.com/",
  DATABASE_URL: "postgresql://user:pw@localhost:5432/app",
};

test("accepts a valid environment and normalizes values", () => {
  const env = parseEnv({ ...valid, NODE_ENV: "production" });
  assert.deepEqual(env.scopes, ["read_products", "write_products"]);
  assert.equal(env.appUrl, "https://example.com");
  assert.equal(env.logLevel, "info");
});

test("reports every missing variable by name", () => {
  assert.throws(
    () => parseEnv({}),
    (err: unknown) => {
      if (!(err instanceof EnvError)) return false;
      const joined = err.problems.join(" ");
      for (const k of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SCOPES", "SHOPIFY_APP_URL", "DATABASE_URL"]) {
        assert.ok(joined.includes(k), `${k} should be reported`);
      }
      return true;
    },
  );
});

test("never puts secret values into the error message", () => {
  try {
    parseEnv({ ...valid, SHOPIFY_API_SECRET: "supersecretvalue", DATABASE_URL: "mysql://u:topsecretpw@h/db" });
    assert.fail("should have thrown");
  } catch (err) {
    const message = err instanceof EnvError ? err.message : "";
    assert.ok(err instanceof EnvError);
    assert.ok(!message.includes("topsecretpw"));
    assert.ok(!message.includes("supersecretvalue"));
  }
});

test("requires https in production but allows http in development", () => {
  assert.throws(() => parseEnv({ ...valid, SHOPIFY_APP_URL: "http://example.com", NODE_ENV: "production" }), EnvError);
  assert.doesNotThrow(() => parseEnv({ ...valid, SHOPIFY_APP_URL: "http://localhost:3000", NODE_ENV: "development" }));
});

test("rejects non-postgres database URLs, bad scopes, bad NODE_ENV and bad LOG_LEVEL", () => {
  assert.throws(() => parseEnv({ ...valid, DATABASE_URL: "file:dev.sqlite" }), EnvError);
  assert.throws(() => parseEnv({ ...valid, SCOPES: "read products" }), EnvError);
  assert.throws(() => parseEnv({ ...valid, NODE_ENV: "staging" }), EnvError);
  assert.throws(() => parseEnv({ ...valid, LOG_LEVEL: "verbose" }), EnvError);
});

test("rejects an invalid app URL", () => {
  assert.throws(() => parseEnv({ ...valid, SHOPIFY_APP_URL: "not a url" }), EnvError);
});

test("email defaults to the safe sink and real sending needs explicit configuration", () => {
  assert.equal(parseEnv(valid).email.mode, "sink");
  assert.throws(() => parseEnv({ ...valid, EMAIL_MODE: "resend" }), EnvError);
  assert.equal(parseEnv({ ...valid, EMAIL_MODE: "resend", EMAIL_FROM: "a@b.co", RESEND_API_KEY: "k" }).email.mode, "resend");
  assert.throws(() => parseEnv({ ...valid, EMAIL_MODE: "smtp" }), EnvError);
});

test("storage is disabled by default and rejects half-configured setups", () => {
  assert.equal(parseEnv(valid).storage, null);
  assert.throws(() => parseEnv({ ...valid, S3_BUCKET: "b" }), EnvError);
  const full = { S3_ENDPOINT: "https://s3.example.com", S3_BUCKET: "b", S3_REGION: "auto", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "sk", S3_PUBLIC_BASE_URL: "https://cdn.example.com/" };
  assert.equal(parseEnv({ ...valid, ...full }).storage?.publicBaseUrl, "https://cdn.example.com");
});

test("the email webhook secret is optional and read when present", () => {
  assert.equal(parseEnv(valid).email.webhookSecret, null);
  assert.equal(parseEnv({ ...valid, RESEND_WEBHOOK_SECRET: "whsec_abc" }).email.webhookSecret, "whsec_abc");
});
