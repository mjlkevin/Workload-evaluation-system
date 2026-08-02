import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderPrompt, resolvePrompt } from "./prompt-registry";

test("resolves the built-in rag-answer v1 with a stable hash", () => {
  const first = resolvePrompt("rag-answer", 1, path.join(os.tmpdir(), "missing-rag-prompts.json"));
  const second = resolvePrompt("rag-answer", 1, path.join(os.tmpdir(), "missing-rag-prompts.json"));
  assert.equal(first.hash, second.hash);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.match(renderPrompt(first, { context: "fixture context" }), /fixture context/);
});

test("loads an exact prompt version and rejects unknown versions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wes-rag-prompts-"));
  const file = path.join(dir, "prompts.json");
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    prompts: {
      "rag-answer": [{
        id: "rag-answer",
        version: 2,
        template: "REGISTRY_V2\n{{context}}",
        variables: ["context"],
      }],
    },
  }));
  const prompt = resolvePrompt("rag-answer", 2, file);
  assert.equal(renderPrompt(prompt, { context: "CTX" }), "REGISTRY_V2\nCTX");
  assert.throws(() => resolvePrompt("rag-answer", 3, file), /prompt_not_found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("renderPrompt rejects missing declared variables", () => {
  const prompt = resolvePrompt("rag-answer", 1, path.join(os.tmpdir(), "missing-rag-prompts.json"));
  assert.throws(() => renderPrompt(prompt, {}), /missing_prompt_variable:context/);
});
