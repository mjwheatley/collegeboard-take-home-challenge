# Decision Log

Running record of changes and the reasoning behind them, kept while the codebase is
reorganized. Each entry should have enough context to be lifted into `ARCHITECTURE.md`
once the shape of the solution settles. Newest entries at the bottom of each section.

## Scope note

The take-home brief asks for AWS CDK **or** Terraform. This project instead uses
**SST v3** (Pulumi-based) as a personal exploration — the author has production experience
with SST v2 (which wraps CDK) and wants to evaluate the v3/Pulumi rewrite against it.
This is a deliberate deviation from the letter of the brief, documented here so it isn't
mistaken for a misunderstanding of the requirements. `cdk synth` / `terraform plan` won't
apply; `sst diff` / `sst deploy --stage <stage>` (or dry-run equivalent) is the validation
path instead.

## Repository layout

**Decision:** Keep the flat `src/` layout the starter provided (no `apps/` split — this
is a single-app repo, not a monorepo, so that boundary isn't needed). Only the
`tsconfig` setup is split: a references-only root `tsconfig.json`, plus
`tsconfig.lib.json` (Lambda source, excludes tests), `tsconfig.stacks.json` (`sst.config.ts`
+ IaC code), and `tsconfig.test.json` (co-located `*.test.ts` files).

**Rationale:** The flat layout doesn't separate "things that get bundled into a Lambda"
from "things that only run at synth/deploy time" (IaC) or "things that only run under
Vitest" (tests, test helpers). Giving each of those its own `include`/`exclude` is what
lets tests live next to the source file they cover (`item.ts` + `item.test.ts` in the
same folder) without leaking into the deployable build output.

**Alternatives considered:** Keep tests in `src/__tests__/` (status quo) — rejected
because co-located tests are preferred. A full `apps/<name>` directory split — rejected
as unnecessary churn for a single-app repo; the tsconfig split alone achieves the actual
goal (separating build/test/IaC compilation roots) without moving files.

**Implementation note:** `tsc --build` hard-fails (`TS18003`) on a referenced project
whose `include` matches zero files — it's an error, not a warning. `tsconfig.stacks.json`
exists on disk (`include: ["sst.config.ts", "infra/**/*.ts"]`) but is deliberately left
out of the root `tsconfig.json`'s `references` until task 7 adds a real `sst.config.ts`;
wiring it in earlier would break `pnpm build` for every task in between. Root
`tsconfig.json` currently references only `tsconfig.lib.json` and `tsconfig.test.json`.
A shared `tsconfig.base.json` holds the common `compilerOptions` (this repo has no
monorepo-level base to extend, unlike the multi-app setup this pattern is drawn from).
`package.json`'s `build` script changed from `tsc` to `tsc --build` since the root
config is now references-only (`files: []`) and has no `include` of its own.

## Infrastructure: SST v3 / Pulumi

**Decision:** Use SST v3 for IaC.

**Rationale:** SST v2 (CDK-based) was preferred by the author over raw CDK because it
orchestrates multi-construct stacks and gives a better local-dev loop against live
infrastructure (`sst dev` / Live Lambda). SST v3 replaces the CDK engine with Pulumi and
changes the API substantially (no more `stacks/*Stack.ts` + `StackContext`, no `bind()`
resource binding — v3 uses `sst.aws.*` components + `Resource` linking). This is being
tried for the first time here specifically to compare it against the v2 experience.

**Consequence:** Prior SST experience the author is drawing on for config shape
(env-per-stage values, default function props/env vars) is SST v2 (CDK-based), so it's
useful for *shape* but not directly portable — each pattern is being re-expressed in
v3's component API rather than copied.

**`server.ts` removal:** The starter's local dev server (`src/server.ts`) is being
dropped in favor of `sst dev`, which runs the actual Lambda handlers locally against
live/linked infrastructure. Keeping both would mean maintaining two separate local
execution paths for the same handlers.

## Environment / stage configuration

**Decision:** Port the *shape* of a `StackConfiguration` pattern (a
`Record<AccountStage, {...}>` per-stage config object, validated where possible with
Zod), scaled down to what this project actually needs (DynamoDB table name/endpoint,
region, log level — not a full domain-specific config).

**`AccountStage`:** `Development | Staging | Production`. The source pattern this is
based on relies on an `AccountStage` enum and stage-resolution helpers
(e.g. `getLongRunningStage`, `isProductionLikeStage`) from a private shared library this
repo has no access to — those are being rolled by hand, scoped to just the three stages
above and only the resolution logic this project actually needs, rather than
reimplementing the whole library.

**Env vars for Lambda handlers:** DynamoDB table name/endpoint/region will be set once
in SST's function defaults (the v3 equivalent of a shared "default function
props/environment" helper from prior SST v2 experience) so every handler picks them up
without per-function wiring, matching the existing `USE_DYNAMODB` / `DYNAMODB_TABLE_NAME`
/ `DYNAMODB_ENDPOINT` vars already read in `src/storage/dynamodb.ts`.

## Types & validation

**Decision:** Consolidate the duplicated shape between `ExamItem`, `CreateItemRequest`,
and `UpdateItemRequest` in `src/types/item.ts` (currently three hand-written interfaces
that repeat `content` and `metadata` shapes) into a single Zod schema per concept, with
the TS types derived via `z.infer`. `CreateItemRequest`/`UpdateItemRequest` become
derived variants (`.omit()`/`.partial()`) of the base `ExamItem` schema instead of
separately hand-maintained interfaces.

**Rationale:** Hand-duplicated `content`/`metadata` shapes across three interfaces is
exactly the kind of drift Zod + `z.infer` prevents — one schema is the source of truth
for both runtime validation and the compile-time type.

## Middleware

**Decision:** Port a minimal middleware pattern seen in prior work — specifically Zod
request/response validation as a Middy (`@middy/core`) middleware — rather than a full
middleware stack (CORS, metrics, tracing, feature flags, etc.), most of which depends on
infrastructure this project doesn't have (observability tooling, feature-flag service).

**Rationale:** The brief calls for "proper error handling and validation" — a small
Zod validation middleware is directly reusable in shape; other cross-cutting concerns
(observability, feature flags) are out of scope here.

## Data model: single-table design for versions + audit trail

**Endpoint naming discrepancy:** The brief's route list has `POST /api/items/:id/versions`
(create a version) but no matching `GET /api/items/:id/versions` — only
`GET /api/items/:id/audit`. Taken literally, that means "audit" is the only read path for
version history, which conflates two different concepts: *version history* ("what did
this item look like at each point in time" — full snapshots) and *audit trail* ("who
changed what, when" — a change log). If a plain array of version snapshots were wanted,
the more RESTful shape would be `GET /api/items/:id/versions` (paginated the same way as
`GET /api/items`), mirroring the `POST` route instead of overloading `/audit` for it.
Since the brief only gives us `/audit`, that route is being treated as the change-log
endpoint (see below) rather than a snapshot dump — noted here so the deviation from a
literal reading of `getAuditTrail(): Promise<ExamItem[]>` is a documented choice, not an
oversight.

**Decision:** Single-table design. One table, `PK = itemId`, with `SK` prefixes
distinguishing record kinds sharing that partition:

| SK | holds |
|---|---|
| `latest` | current full `ExamItem` |
| `VERSION#0002` | full `ExamItem` snapshot as of version 2 |
| `AUDIT#<timestamp>#0002` | lightweight change-log entry for the transition to version 2 |

`updateItem` writes `latest` + a new `VERSION#` snapshot + a new `AUDIT#` entry in one
`TransactWriteItems` call. `getAuditTrail(id)` becomes `Query(PK=id, SK begins_with
"AUDIT#")`, returning `AuditEntry[]` — **a breaking change to `ItemStorage`'s
`getAuditTrail` return type** (`ExamItem[] → AuditEntry[]`), tracked as a deliberate
decision, not an oversight.

**Rationale:** Given this domain (exam content with a `securityLevel` field and an
approval workflow — draft/review/approved/archived), knowing *who* moved an item to
`approved` or edited `content.correctAnswer` is more valuable than just diffable
snapshots. Folding both record kinds into one table (rather than a separate audit-log
table) keeps the update transactional and same-table, and this is the same
`PK`/`SK`-overloading technique described under "sort-key-per-version" above, just
scoped to two record kinds instead of one — the natural single-table extension of that
approach.

**`AuditEntry` shape (initial):**

```ts
{
  itemId: string;
  version: number;
  action: "created" | "updated";
  changedBy: string;       // see auth note below — placeholder until real identity exists
  changedFields: string[]; // e.g. ["metadata.status", "content.correctAnswer"]
  timestamp: number;
}
```

## Authentication (deferred)

**Decision:** Defer implementing auth, but leaning toward Cognito, with manual user
onboarding as the *provisioning* mechanism for it (not an alternative to it). Shape:
provision a Cognito User Pool in IaC; onboard users manually via the AWS console (no
self-service sign-up) rather than seeding a pool programmatically for this exercise;
users authenticate with username/password to obtain an access token (either via a
custom auth endpoint that does the exchange, or Cognito's hosted UI) and send that
token in the API's `Authorization` header; endpoints are then guarded by a Cognito
authorizer configured against that user pool. Not committing to build this yet — API
keys remain a fallback if Cognito setup proves too much for the time box.

**Why deferred:** Cognito gives real per-user identity for `AuditEntry.changedBy`, but
manual console onboarding means there's no programmatic seeding step to build for this
exercise — a meaningful reduction in scope over standing up a self-service sign-up flow
or scripting user creation. The remaining open items are: whether to write a custom
auth endpoint for the credential-to-token exchange or rely on the Cognito hosted UI, and
whether the time box allows wiring the authorizer at all. API keys were also
considered as a simpler fallback, but identify a *client*, not a *user* — insufficient
for a per-user `changedBy` on audit entries.

**Consequence:** Until an auth mechanism lands, `AuditEntry.changedBy` has no real
identity source to draw from — `metadata.author` on the request body is a
self-reported, unauthenticated placeholder, not a verified caller identity. Treat any
audit trail output before auth lands as provisional.

## Linting

**Decision:** `eslint.config.mjs` starts from a known-good `typescript-eslint`
flat-config baseline (strict + stylistic type-checked rules via `projectService`) and
adds just what this project needs — `import-x` ordering/no-extraneous-dependencies
rules (with exceptions for `*.test.ts`, `sst.config.ts`, `eslint.config.mjs`,
`lint-staged.config.mjs`, `vitest.config.ts`), `no-restricted-imports` for yup/lodash →
prefer Zod, and general style rules (padding-line-between-statements, id-length).
Deliberately skipping monorepo/Nx-specific plugins, Next.js/React/Tailwind rules, and
testing-library rules — none apply to this standalone Node/Lambda API project.

**Implementation notes:**
- `createNodeResolver` lives in `eslint-plugin-import-x`, not
  `eslint-import-resolver-typescript` (easy to mix up — both packages deal with import
  resolution, but only `import-x` exports the plain-Node fallback resolver).
- `tseslintConfigs.disableTypeChecked` is a single flat-config object in
  `typescript-eslint@8.70.0`, not an array — a reference config written against an
  older/different version treated it as one.
- `noWarnOnMultipleProjects` (suppressing the "multiple projects found" console
  warning) is an option on `createTypeScriptImportResolver(...)`
  (`eslint-import-resolver-typescript`), not on typescript-eslint's own
  `parserOptions.projectService` — despite both warning about the same "multiple
  tsconfigs" situation, the option only exists on the resolver's config.
- `eslint.config.mjs` and `lint-staged.config.mjs` are covered by
  `parserOptions.projectService.allowDefaultProject` and a
  `tseslintConfigs.disableTypeChecked` override (type-aware linting doesn't apply —
  neither file is included in `tsconfig.lib.json`/`tsconfig.test.json`/
  `tsconfig.stacks.json`).
- Running `eslint .` immediately surfaces real, pre-existing issues in
  `src/server.ts`, `src/storage/*.ts`, and `src/handlers/example.ts` (missing `await`,
  `||` vs `??`, unused imports, etc.) — see "Immediate lint cleanup" below for how
  these were resolved rather than deferred.

## Immediate lint cleanup

**Decision:** Fixed every error `eslint .` surfaced across the starter code
immediately, in the same pass as adding the config, rather than deferring to whichever
later task naturally touches each file. `eslint .`, `pnpm typecheck`, and `pnpm test`
all pass clean as of this point.

**What changed, and why each was a real fix (not just satisfying a rule):**
- `src/handlers/example.ts`: `createItemHandler(data: any)` → `data: CreateItemRequest`.
  Runtime validation is still task 3's job (the `// TODO: Add validation using Zod`
  comment stays), but the parameter no longer silently accepts anything.
- `src/handlers/example.test.ts`: removed an unused `beforeEach` import.
- `src/server.ts`: `JSON.parse(body)` now types as `unknown` instead of implicit `any`,
  with an explicit `as CreateItemRequest` at the one call site that needs it (marked
  with the same Zod-validation TODO as above — an explicit assertion documents "this is
  unvalidated" more honestly than an implicit `any` did). `req.on('data', chunk => ...)`
  now types `chunk: Buffer` explicitly instead of relying on the ambient `any`.
  `url.split('/').pop()` (which can return `undefined`) is handled with a conditional
  instead of a non-null assertion. `createServer(handleRequest)` — passing an `async`
  function directly as a listener is a genuine bug shape (`no-misused-promises`): a
  rejected promise inside `handleRequest` would become an unhandled rejection instead of
  being caught by anything, since `http.Server`'s listener type doesn't await its
  return; wrapped it in a listener that discards the promise explicitly (`void
  handleRequest(req, res)`) — `handleRequest` already has its own try/catch, so this is
  just making the "fire and forget" explicit rather than accidental.
- `src/storage/dynamodb.ts`: removed unused `UpdateCommand`/`QueryCommand` imports
  (leftover from before those operations were implemented — task 6 will reintroduce
  transactional writes and queries for the single-table design, at which point these
  come back). All `||` default-value patterns (`query.limit || 10`,
  `result.Count || 0`, region/table-name env var fallbacks) switched to `??` — a real
  correctness fix, since `||` incorrectly falls back to the default when the actual
  value is a valid falsy one like `0`. `result.Item as ExamItem || null` → `(result.Item
  as ExamItem | undefined) ?? null`, which keeps `undefined` in the type instead of
  casting it away before the fallback ever runs. `createVersion`/`getAuditTrail` stubs:
  dropped the pointless `async` keyword (they throw synchronously — `async` added
  nothing) and prefixed the unused `id` param with `_` to mark it as intentionally
  unused rather than suppressing the check project-wide.
- `src/storage/memory.ts`: same `||` → `??` correctness fix throughout (notably
  `query.offset || 0` / `query.limit || 0`, where a legitimate `offset: 0` was being
  silently overridden). Added a scoped `@typescript-eslint/require-await: off` override
  in `eslint.config.mjs` for this file specifically, rather than fixing each method —
  this storage backend is deliberately synchronous (it's the in-memory/local-dev
  implementation), and the interface's methods are typed `Promise<T>` so real backends
  (DynamoDB) can actually be async; the `async` keyword is what makes a sync return
  value satisfy `Promise<T>`, not a sign that an `await` was forgotten. This is the
  documented use case for disabling this specific rule, not a workaround.
- `eslint.config.mjs`: added `@typescript-eslint/restrict-template-expressions: off`
  project-wide (matching the reference config's choice) — the rule's default (any
  non-`string`/`number`-with-`allowNumber` type in a template literal is an error) was
  flagging `${method} ${url}` (both possibly `undefined` on `IncomingMessage`) and
  `${PORT}` (a `number`), neither of which is a real bug.

## Pre-commit hooks

**Decision:** `husky` (`prepare` script installs hooks) + `lint-staged`
(`lint-staged.config.mjs`) on `pre-commit`. For staged `*.ts` files: `eslint --fix`
scoped to just those files (lint-staged appends the staged filenames), then two
whole-project checks regardless of which files matched — `pnpm typecheck`
(`tsc --build`) and `pnpm test` (`vitest run`), invoked via the `package.json` scripts
rather than raw CLI commands so there's one source of truth for those commands.

**Rationale:** This is a single-package repo, not a monorepo — there's no `nx
affected`-style project graph to scope typecheck/test to just the changed project, and
tsc's project references / vitest's suite aren't meaningfully file-scoped here anyway,
so those two run against the whole project on every commit rather than being filtered
by filename.

**Considered and rejected:** Routing `eslint --fix` through the `pnpm lint:fix` script
instead of the raw `eslint --fix` binary — rejected because `pnpm lint:fix` runs
`eslint . --fix` (the whole repo), so lint-staged's staged-filenames would just be
appended as redundant extra args on top of an already-whole-repo lint. That would make
every commit auto-fix (and potentially leave unstaged changes in) files that weren't
even part of the commit. Kept `eslint --fix` as the one exception to "use package.json
scripts" for this reason — it needs the staged filenames appended by lint-staged, which
only happens for string commands, and scoping it to a script command loses that
per-file targeting.

## Open questions / follow-ups

- ~~Confirm final app directory name~~ — resolved: flat `src/`, tsconfig split only, no
  `apps/` folder.
- ~~Confirm which `AccountStage` values this project needs~~ — resolved: `Development`,
  `Staging`, `Production`.
- ~~Decide DynamoDB versioning/audit-trail strategy~~ — resolved: single-table design,
  `VERSION#`/`AUDIT#` sort-key prefixes on the same `PK = itemId` partition (see
  "Data model: single-table design" above).
- Decide whether/how to build auth (Cognito User Pool + authorizer, manually onboarded
  users, custom token-exchange endpoint vs. hosted UI — vs. API keys as a fallback) —
  deferred, leaning Cognito. Blocks giving `AuditEntry.changedBy` a real identity
  source (see "Authentication (deferred)" above).
