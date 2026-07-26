/** Unit tests for the ~/.myos base layout. */

import { describe, it, expect } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLayout } from "../src/paths.js";

const BASE = join(tmpdir(), "myos-paths-test");

describe("ensureLayout", () => {
  it("creates the base tree", async () => {
    await rm(BASE, { recursive: true, force: true });
    await ensureLayout(BASE);
    for (const dir of ["run", "logs", "data"]) {
      expect(existsSync(join(BASE, dir))).toBe(true);
    }
  });
});
