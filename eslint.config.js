import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const commonRules = {
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-redeclare": "error",
  "no-unreachable": "error",
  "no-unused-vars": ["error", {
    args: "after-used",
    argsIgnorePattern: "^_",
    caughtErrors: "none",
    ignoreRestSiblings: true,
    varsIgnorePattern: "^_",
  }],
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  "no-undef": "error",
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "data/**",
      "artifacts/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["src/**/*.{js,jsx}", "backend/src/**/*.js", "tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.es2025,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...commonRules,
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
    settings: {
      react: {
        version: "19.2",
      },
    },
  },
  {
    files: ["backend/src/**/*.js", "tools/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.test.jsx", "backend/src/**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
];
