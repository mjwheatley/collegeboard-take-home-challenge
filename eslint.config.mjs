import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { createNodeResolver, flatConfigs as importXConfigs } from "eslint-plugin-import-x";
import globals from "globals";
import { configs as tseslintConfigs } from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "*.tsbuildinfo",
      ".sst/**",
      "sst-env.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslintConfigs.strictTypeChecked,
  ...tseslintConfigs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "lint-staged.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  importXConfigs.recommended,
  importXConfigs.typescript,
  {
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: ["tsconfig.lib.json", "tsconfig.test.json", "tsconfig.stacks.json", "tsconfig.sst.json"],
          noWarnOnMultipleProjects: true,
        }),
        createNodeResolver({ extensions: [".js", ".ts", ".mjs", ".cjs"] }),
      ],
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/array-type": ["error", { default: "array" }],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "import-x/order": [
        "error",
        {
          alphabetize: { order: "asc", caseInsensitive: true },
          groups: ["builtin", "external", "internal", "parent", ["sibling", "index"], "type"],
          "newlines-between": "always",
        },
      ],
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: [
            "**/eslint.config.mjs",
            "**/lint-staged.config.mjs",
            "**/vitest.config.ts",
            "**/*.test.ts",
            "**/sst.config.ts",
          ],
        },
      ],
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            { name: "yup", message: "Use Zod instead of Yup." },
            { name: "lodash", message: "Are you sure you should be using lodash?" },
          ],
          patterns: [{ group: ["lodash/*"], message: "Are you sure you should be using lodash?" }],
        },
      ],
      "id-length": ["error", { exceptions: ["_", "a", "b", "i", "j"], min: 2, properties: "never" }],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", next: "return", prev: "*" },
        { blankLine: "always", next: "throw", prev: "*" },
        { blankLine: "always", next: "*", prev: ["const", "let", "var"] },
        { blankLine: "any", next: ["const", "let", "var"], prev: ["const", "let", "var"] },
        { blankLine: "always", next: "if", prev: "*" },
        { blankLine: "always", next: "*", prev: "if" },
      ],
      "object-shorthand": ["error", "always"],
      "prefer-const": ["error", { destructuring: "all" }],
      "prefer-promise-reject-errors": "error",
      "no-throw-literal": "error",
      "no-template-curly-in-string": "error",
    },
  },
  {
    // Deliberately synchronous under an async ItemStorage interface (local dev only);
    // the async keyword is what makes returns satisfy Promise<T>, not a real await.
    files: ["src/storage/memory.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "id-length": "off",
    },
  },
  {
    files: ["**/eslint.config.mjs", "**/lint-staged.config.mjs"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: false,
      },
    },
    rules: {
      ...tseslintConfigs.disableTypeChecked.rules,
      "import-x/no-extraneous-dependencies": "off",
    },
  },
  {
    // SST's own generated boilerplate requires this exact triple-slash directive to
    // pull in the Ion component types -- there's no `import` form for it.
    files: ["sst.config.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
);
