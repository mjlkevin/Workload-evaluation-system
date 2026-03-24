import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

function runScript(scriptPath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.resolve(__dirname, "..", "..", "..")
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("api integration script passes", async () => {
  const scriptPath = path.resolve(__dirname, "..", "..", "..", "scripts", "api-integration-check.js");
  const result = await runScript(scriptPath);
  assert.equal(result.code, 0, `script_exit_code=${result.code}\n${result.stderr || result.stdout}`);
  assert.match(result.stdout, /"ok"\s*:\s*true/);
});
