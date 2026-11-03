import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs scripts have no type declarations
import { testDbProblem } from "../scripts/verify-phase3.mjs";

test("the Phase 3 gate refuses unsafe or missing test database URLs", () => {
  assert.equal(testDbProblem("postgresql://u:p@localhost:5432/reviews_test"), null); // secret-scan:ignore fake
  assert.ok(testDbProblem(""));
  assert.ok(testDbProblem("postgresql://u:p@localhost:5432/production")); // secret-scan:ignore fake
  assert.ok(testDbProblem("mysql://u:p@localhost/app_test")); // secret-scan:ignore fake
  assert.ok(testDbProblem("not a url"));
});
