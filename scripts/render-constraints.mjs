#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { renderPostgresSql } from "../prisma/constraints.mjs";
writeFileSync(new URL("../prisma/constraints.sql", import.meta.url), renderPostgresSql());
console.log("Wrote prisma/constraints.sql");
