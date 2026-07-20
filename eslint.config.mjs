import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  ...tseslint.configs.recommended,
  {
    settings: {
      next: { rootDir: "apps/web" },
      react: { version: "19.2" }
    }
  },
  {
    files: ["apps/worker/**/*.ts", "packages/shared/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error"
    }
  },
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/node_modules/**",
    "apps/worker/src/worker-configuration.d.ts"
  ])
]);
