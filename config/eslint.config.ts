// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

import eslint from "@eslint/js";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export default tseslint.config(
  {
    ignores: ["dist/", "dist-cli/", "coverage/", "node_modules/", "config/eslint.config.ts"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["scripts/**/*.ts"],
  },
  {
    files: ["src/**/*.ts", "config/vite.config.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./config/tsconfig.json"],
        tsconfigRootDir: repositoryRoot,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-confusing-void-expression": "off"
    },
  },
  {
    files: ["**/*.spec.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-base-to-string": "off"
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          "patterns": [
            {
              "group": ["**/adapters/**", "**/applications/**", "**/interfaces/**"],
              "message": "Core must remain independent of outer layers."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/applications/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          "patterns": [
            {
              "group": ["**/adapters/**", "**/interfaces/**"],
              "message": "Applications depend on ports and core, never concrete adapters or interfaces."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          "patterns": [
            {
              "group": ["**/interfaces/**"],
              "message": "Adapters must not depend on composition roots."
            }
          ]
        }
      ]
    }
  },
);
