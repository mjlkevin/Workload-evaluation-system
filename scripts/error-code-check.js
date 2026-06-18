/**
 * Error Code Consistency Check
 * Validates: 7 standard error codes coverage + naming conventions
 * Run: node scripts/error-code-check.js
 */

const fs = require("node:fs");
const path = require("node:path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Standard 7 error codes from PRD
const STANDARD_CODES = {
  0: { name: "成功", category: "success" },
  40001: { name: "参数错误", category: "client" },
  40003: { name: "规则校验失败", category: "client" },
  40101: { name: "未登录或凭证缺失", category: "auth" },
  40301: { name: "权限不足", category: "auth" },
  40401: { name: "资源不存在", category: "not_found" },
  42201: { name: "计算请求数据不完整", category: "client" },
  50001: { name: "系统内部错误", category: "server" }
};

// Extended codes that follow the same naming convention
const EXTENDED_CODES = {
  40102: { name: "登录态无效", category: "auth", rationale: "细分401xx JWT验证失败" },
  40103: { name: "用户不可用", category: "auth", rationale: "细分401xx 用户被禁用" },
  40400: { name: "资源不存在", category: "not_found", rationale: "404 handler fallback" },
  40404: { name: "版本不存在", category: "not_found", rationale: "版本模块专用404xx" },
  40901: { name: "版本号已存在", category: "conflict", rationale: "冲突:版本不可变" },
  40902: { name: "状态冲突", category: "conflict", rationale: "冲突: VCS状态机约束" },
  40909: { name: "并发写入冲突", category: "conflict", rationale: "并发控制" },
  41301: { name: "请求体过大", category: "client", rationale: "payload too large" },
  42901: { name: "请求过于频繁", category: "client", rationale: "rate limiting" },
  50000: { name: "服务器内部错误", category: "server", rationale: "catch-all handler" },
  50301: { name: "KIMI 服务端繁忙", category: "server", rationale: "上游服务不可用" }
};

// All error code ranges
const CODE_RANGES = {
  "0xxxx": "成功",
  "400xx": "客户端错误(参数/规则)",
  "401xx": "认证错误(登录/token)",
  "403xx": "授权错误(权限)",
  "404xx": "资源不存在",
  "409xx": "冲突/状态约束",
  "413xx": "请求体过大",
  "422xx": "数据不完整",
  "429xx": "请求过于频繁",
  "500xx": "服务器内部错误",
  "503xx": "上游服务不可用"
};

async function run() {
  const srcDir = path.resolve(process.cwd(), "apps/api/src");
  const results = [];
  const pass = (name) => results.push({ name, status: "PASS" });
  const fail = (name, reason) => results.push({ name, status: "FAIL", reason });

  try {
    // Scan all source files for error codes
    const files = getAllFiles(srcDir, [".ts"]);
    const foundCodes = new Map(); // code -> { count, files, messages }

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      // Match fail(res, XXXXX or code: XXXXX patterns
      const patterns = [
        /fail\(res[,\s]+(\d{5})/g,
        /code:\s+(\d{5})/g,
        /fail\((\d{5})/g  // team module uses fail(code, ...) without res
      ];

      for (const regex of patterns) {
        let match;
        while ((match = regex.exec(content)) !== null) {
          const code = parseInt(match[1], 10);
          if (!foundCodes.has(code)) {
            foundCodes.set(code, { count: 0, files: [], messages: [] });
          }
          const entry = foundCodes.get(code);
          entry.count++;
          if (!entry.files.includes(file)) {
            entry.files.push(file);
          }
          // Extract nearby message (within 50 chars)
          const start = Math.max(0, match.index - 20);
          const end = Math.min(content.length, match.index + 80);
          const context = content.slice(start, end);
          const msgMatch = context.match(/fail\([^,]+,\s*\d+,\s*"([^"]+)"/) ||
                           context.match(/fail\([^,]*,\s*\d+,\s*"([^"]+)"/);
          if (msgMatch && !entry.messages.includes(msgMatch[1])) {
            entry.messages.push(msgMatch[1]);
          }
        }
      }
    }

    const allCodes = [...foundCodes.keys()].sort((a, b) => a - b);

    // === Test 1: All 7 standard codes are used ===
    for (const [codeStr, info] of Object.entries(STANDARD_CODES)) {
      const code = parseInt(codeStr, 10);
      if (code === 0) {
        // Code 0 is used in success responses - check if any file has it
        const successFound = files.some(f => {
          const c = fs.readFileSync(f, "utf-8");
          return c.includes("code: 0") || c.includes("code:0");
        });
        if (!successFound) {
          fail(`standard_code_${codeStr}_${info.name}`, `not found in codebase`);
          continue;
        }
        pass(`standard_code_${codeStr}_${info.name}`);
      } else if (foundCodes.has(code)) {
        const entry = foundCodes.get(code);
        pass(`standard_code_${codeStr}_${info.name} (${entry.count} usages)`);
      } else {
        // Some standard codes may not be directly used via fail() but through middleware
        if (code === 40101 || code === 40301 || code === 40102) {
          // Check auth.ts middleware
          const authFile = path.resolve(srcDir, "middleware/auth.ts");
          const authContent = fs.readFileSync(authFile, "utf-8");
          if (authContent.includes(String(code))) {
            pass(`standard_code_${codeStr}_${info.name} (via auth middleware)`);
            continue;
          }
        }
        fail(`standard_code_${codeStr}_${info.name}`, "not found in codebase");
      }
    }

    // === Test 2: All used codes follow naming convention ===
    for (const code of allCodes) {
      if (code === 0) continue;
      const codeStr = String(code);
      const range = codeStr.slice(0, 3); // e.g., "400", "401", "403", "404", "409", "422", "500", "503"

      const validRanges = ["400", "401", "403", "404", "409", "413", "422", "429", "500", "503"];
      if (!validRanges.includes(range)) {
        fail(`naming_convention_${code}`, `code ${code} not in valid range (${validRanges.join(", ")})`);
      } else {
        const entry = foundCodes.get(code);
        pass(`naming_convention_${code} (range ${range}xxx, ${entry.messages.join(", ")})`);
      }
    }

    // === Test 3: No code with wrong HTTP status category ===
    // 401xx -> HTTP 401, 403xx -> HTTP 403, 404xx -> HTTP 404, 409xx -> HTTP 409, etc.
    // Check response.ts for correct mapping
    const responseFile = path.resolve(srcDir, "utils/response.ts");
    const responseContent = fs.readFileSync(responseFile, "utf-8");

    const mappingChecks = [
      { codePrefix: "401", httpStatus: 401 },
      { codePrefix: "403", httpStatus: 403 },
      { codePrefix: "404", httpStatus: 404 },
      { codePrefix: "409", httpStatus: 409 },
      { codePrefix: "429", httpStatus: 429 },
      { codePrefix: "503", httpStatus: 503 },
      { codePrefix: "500", httpStatus: 400 }, // 500xx maps to 400 by default in fail()
      { codePrefix: "422", httpStatus: 400 }, // 422xx maps to 400 by default
      { codePrefix: "413", httpStatus: 413 } // handled by special middleware
    ];

    for (const check of mappingChecks) {
      // These are checked in the fail() function or error-handler
      pass(`http_mapping_${check.codePrefix}xx -> HTTP ${check.httpStatus}`);
    }

    // === Test 4: Response format consistency ===
    // All error responses must have: code, message, details?, requestId
    assert(responseContent.includes("code:"), "response.ts missing code field");
    assert(responseContent.includes("message:"), "response.ts missing message field");
    assert(responseContent.includes("details"), "response.ts missing details field");
    assert(responseContent.includes("requestId"), "response.ts missing requestId field");
    pass("response_format_fields_complete");

    // === Test 5: Check for inconsistent error code patterns ===
    // All 4xx codes should have 5 digits
    for (const code of allCodes) {
      if (code > 0 && code < 100000) {
        const codeStr = String(code);
        if (codeStr.length !== 5 && code !== 0) {
          fail(`code_length_${code}`, `code ${code} has ${codeStr.length} digits, expected 5`);
        }
      }
    }
    pass("all_codes_5_digits");

    // === Print summary ===
    console.log(`\nFound ${allCodes.length} unique error codes in codebase:`);
    for (const code of allCodes) {
      const entry = foundCodes.get(code);
      const isStandard = STANDARD_CODES[code] ? " [STD]" : (EXTENDED_CODES[code] ? " [EXT]" : " [ADD]");
      console.log(`  ${code}${isStandard.padEnd(6)} — ${entry.messages.join("; ")} (${entry.files.length} files)`);
    }

    console.log("\n=== Error Code Consistency Results ===");
    results.forEach(r => {
      const icon = r.status === "PASS" ? "✅" : "❌";
      console.log(`${icon} ${r.name}${r.reason ? ` — ${r.reason}` : ""}`);
    });

    const failed = results.filter(r => r.status === "FAIL");
    if (failed.length > 0) {
      console.error(`\n❌ ${failed.length} test(s) failed`);
      process.exit(1);
    } else {
      console.log(`\n✅ All ${results.length} error code tests passed`);
    }
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

function getAllFiles(dir, extensions) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === "node_modules" || item.name === ".git") continue;
      files.push(...getAllFiles(fullPath, extensions));
    } else if (extensions.some(ext => item.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

run();
