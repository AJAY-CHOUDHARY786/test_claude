import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs scripts have no type declarations
import { redactOutput, nodeVersionOk, envFileProblems } from "../scripts/verify-phase2.mjs";

const TOKEN = "shp" + "at_" + "0123456789abcdef0123456789";
test("report output masks tokens, database passwords and secret assignments", () => {
  const out = redactOutput(`token ${TOKEN} url postgresql://admin:${"hunter" + "2pass"}@db.example.com/app\nSHOPIFY_API_SECRET=abcd1234efgh`);
  assert.ok(!out.includes(TOKEN) && !out.includes("hunter2pass") && !out.includes("abcd1234efgh"));
  assert.ok(out.includes("postgresql://admin:[REDACTED]@db.example.com/app")); // secret-scan:ignore expected masked output
});
test("supported Node versions", () => {
  for (const v of ["v22.12.0", "v22.22.2", "v20.19.0", "v24.0.0"]) assert.equal(nodeVersionOk(v), true, v);
  for (const v of ["v18.20.0", "v20.18.0", "v22.11.0"]) assert.equal(nodeVersionOk(v), false, v);
});
test("env file check finds a missing DATABASE_URL without reading its value", () => {
  assert.deepEqual(envFileProblems("DATABASE_URL=postgresql://u:p@h/db\n"), []);
  assert.equal(envFileProblems("DATABASE_URL=\nFOO=1").length, 1);
});
