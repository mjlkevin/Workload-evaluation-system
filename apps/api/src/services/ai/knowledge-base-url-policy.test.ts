import assert from "node:assert/strict";
import test from "node:test";

import { assertAllowedZhipuUrl } from "./knowledge-base-url-policy";

test("allows only the official HTTPS Zhipu host", () => {
  const url = assertAllowedZhipuUrl("https://open.bigmodel.cn/api/paas/v4");
  assert.equal(url.hostname, "open.bigmodel.cn");
  assert.equal(url.protocol, "https:");
});

test("rejects insecure, private, credentialed and non-default-port URLs", () => {
  const rejected = [
    "http://open.bigmodel.cn/api/paas/v4",
    "https://127.0.0.1/api/paas/v4",
    "https://user@open.bigmodel.cn/api/paas/v4",
    "https://open.bigmodel.cn:8443/api/paas/v4",
    "https://open.bigmodel.cn.evil.example/api/paas/v4",
  ];
  for (const value of rejected) {
    assert.throws(() => assertAllowedZhipuUrl(value), /knowledge_base_url_not_allowed/);
  }
});
