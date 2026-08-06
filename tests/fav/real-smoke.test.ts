import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FavService } from "../../src/fav/service.js";

const runRealSmoke = process.env.FAV_REAL_SMOKE === "1";

describe.runIf(runRealSmoke)("real HTTP dry-run smoke", () => {
  it("previews a public website and GitHub repository without files or browser", async () => {
    const repoDir = join(tmpdir(), `myos-fav-smoke-must-not-exist-${process.pid}`);
    const service = new FavService({
      fetchDefuddle: async () => { throw new Error("disabled for HTTP-only smoke"); },
      fetchBrowser: async () => { throw new Error("browser disabled for smoke"); },
    });
    const results: Array<Record<string, unknown>> = [];

    for (const url of ["https://linear.app/", "https://github.com/cloudflare/skills"]) {
      try {
        const result = await service.capture({ url, repoDir, dryRun: true });
        results.push({ url, result });
      } catch (error) {
        results.push({ url, error: String(error) });
      }
    }

    process.stdout.write(`FAV_REAL_SMOKE ${JSON.stringify(results)}\n`);
    expect(existsSync(repoDir)).toBe(false);
    expect(results).toHaveLength(2);
  }, 45_000);
});
