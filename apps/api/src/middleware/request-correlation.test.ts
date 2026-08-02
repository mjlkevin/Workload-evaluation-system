import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";

import { requestLogger } from "./request-logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function responseCapture() {
  const headers = new Map<string, string>();
  const response = {
    locals: {},
    statusCode: 200,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    on() { return this; },
  } as unknown as Response;
  return { response, headers };
}

function requestWithId(value?: string) {
  return {
    method: "GET",
    path: "/request-correlation",
    url: "/request-correlation",
    headers: value ? { "x-request-id": value } : {},
    route: { path: "/request-correlation" },
  } as unknown as Request;
}

test("request logger rejects an invalid client request ID", () => {
  const res = responseCapture();
  requestLogger(requestWithId("../../invalid"), res.response, (() => undefined) as NextFunction);
  assert.match(String(res.response.locals.requestId), UUID_RE);
  assert.equal(res.headers.get("x-request-id"), res.response.locals.requestId);
});

test("request logger preserves a valid client UUID", () => {
  const requestId = "00000000-0000-4000-8000-000000000001";
  const res = responseCapture();
  requestLogger(requestWithId(requestId), res.response, (() => undefined) as NextFunction);
  assert.equal(res.response.locals.requestId, requestId);
});
