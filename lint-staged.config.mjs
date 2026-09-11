/**
 * lint-staged configuration.
 *
 * Single-package repo, so unlike a monorepo's `nx affected`-style setup there's no
 * per-project routing: eslint --fix is scoped to the staged files (fast, file-level),
 * while typecheck and test run against the whole project regardless of which files
 * matched, since tsc's project references and vitest's suite aren't meaningfully
 * scoped to a file list here.
 *
 * @type {Record<string, string | string[] | ((filenames: string[]) => string | string[])>}
 */
export default {
  "*.ts": ["eslint --fix", () => "pnpm typecheck", () => "pnpm test"],
};
