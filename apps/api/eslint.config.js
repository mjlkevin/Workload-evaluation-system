// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-namespace": "warn",
      "no-useless-assignment": "warn",
    },
  },
  {
    // 批次 7：MCP stdio stub 是**故意**的裸 CommonJS 测试夹具（模拟最野的第三方，
    // 不经 TS 工程），面向 .ts 的规则对它不适用。
    ignores: ["dist/", "node_modules/", "src/**/__fixtures__/*.cjs"],
  }
);
