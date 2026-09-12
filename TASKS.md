# Tasks

Working list for implementing the decisions in `DECISIONS.md`. Check items off as they
land; add new tasks as decisions are made rather than letting scope drift undocumented.

- [x] **1. tsconfig split**
  - [x] Replace `tsconfig.json` with a references-only file
  - [x] Add `tsconfig.lib.json` (Lambda source, excludes `*.test.ts`)
  - [x] Add `tsconfig.stacks.json` (`sst.config.ts` + IaC code) — wired into root
        `references` as of task 4/5, once `infra/*.ts` gave it real files to include
        (an empty `include` fails `tsc --build`; `sst.config.ts` itself still doesn't
        exist yet — added in task 7)
  - [x] Add `tsconfig.test.json` (co-located `*.test.ts` files)
  - [x] Move `src/__tests__/example.test.ts` next to `src/handlers/example.ts`
  - [x] Update `vitest.config.ts` include pattern if needed — not needed, default
        glob already matches co-located `*.test.ts` anywhere

- [x] **2. Consolidate `src/types/item.ts` with Zod**
  - [x] Single `ExamItemSchema` (Zod) as source of truth for `content`/`metadata` shapes
  - [x] `CreateItemRequest`/`UpdateItemRequest` as `.omit()`/`.partial()` derivatives
  - [x] Types derived via `z.infer`, drop hand-written interfaces
  - [x] `itemType`/`metadata.status`/`securityLevel` tightened to `z.enum(...)`,
        `difficulty` bounded 1–5 — see "Consolidate `src/types/item.ts` with Zod" in
        `DECISIONS.md` for why this went slightly beyond pure consolidation
  - [x] `src/handlers/example.test.ts` fixtures needed `satisfies CreateItemRequest`
        added (enum-typed fields need it to avoid TS widening object literals to `string`)

- [x] **3. Zod validation middleware**
  - [x] Add Middy (`@middy/core`); also `@types/aws-lambda` (dev) since `@middy/core`'s
        own types import `Context`/`Handler` from `aws-lambda`
  - [x] Small `zodValidatorMiddleware` (request + response schema validation) +
        `zodValidatorMiddleware.test.ts`
  - [x] Wire into `getItemHandler`/`createItemHandler` — changed their public signature
        to `(event, context)`; `event` is the normalized domain payload (`{ id }` /
        `CreateItemRequest`), not a raw API Gateway event — see "Event-shape boundary"
        under "Middleware" in `DECISIONS.md` for why, and what task 7 still needs to
        decide (the real API-Gateway-event → this-shape mapping)
  - [x] Updated `src/server.ts` and `src/handlers/example.test.ts` call sites for the
        new `(event, context)` signature (stub `{} as Context`)

- [x] **4. `AccountStage` + stage resolution**
  - [x] Local `AccountStage` enum: `Development | Staging | Production` — 3-letter
        env-style values `dev`/`stg`/`prd`
  - [x] Minimal stage-resolution helper (`resolveAccountStage`, `infra/stage.ts` +
        `infra/stage.test.ts`) — named long-running stages map directly, everything
        else (personal dev stages, PR previews) falls back to `Development`

- [x] **5. `StackConfiguration` per stage**
  - [x] Scaled-down per-stage config: `AWS_REGION`, `LOG_LEVEL` only
        (`infra/stack-configuration.ts` + test) — table name deliberately excluded,
        see "Resource identity is deliberately excluded" in `DECISIONS.md`
        (`AccountStage` buckets collapse distinct raw stages, so a table name looked
        up by bucket would collide across concurrent personal dev stages)
  - [x] Validated shape with Zod (`StackConfigurationSchema`)
  - [x] Both live under a new top-level `infra/` directory (IaC-time code, not
        bundled into Lambdas); `tsconfig.stacks.json` now has real files so it's
        wired into the root `tsconfig.json` references ahead of schedule

- [x] **6. Single-table DynamoDB design**
  - [x] Composite key: `PK = itemId`, `SK` prefixes (`latest`, `VERSION#000N`, `AUDIT#<ts>#000N`)
        — `src/storage/single-table-keys.ts` (+ test)
  - [x] `updateItem`/`createItem`/`createVersion`: `TransactWriteCommand` writing
        `latest` + `VERSION#` snapshot + `AUDIT#` entry atomically
  - [x] `createVersion` / `getAuditTrail` implemented against the new key design
  - [x] `getAuditTrail` return type changes `ExamItem[] → AuditEntry[]` (update `ItemStorage` interface)
  - [x] `AuditEntry` type (`itemId`, `version`, `action`, `changedBy`, `changedFields`,
        `timestamp`) — `action` grew a third value, `version_created`, beyond the
        original `created | updated` sketch (see `DECISIONS.md`)
  - [x] Field-diffing for `changedFields` — `src/storage/audit-diff.ts` (+ test),
        only flags fields the request actually changes vs. the existing value
  - [x] **Added mid-task:** `listVersions(id, query)` on `ItemStorage` — paginated
        (same `PaginationQuery` as `listItems`) full `ExamItem[]` version history,
        resolving the `/audit` vs. `/versions` naming discrepancy noted earlier
        (see "Endpoint naming discrepancy — resolved" in `DECISIONS.md`). Implemented
        in both `MemoryStorage` (re-added a version-snapshot map) and `DynamoDBStorage`
        (single-partition `Query` on `VERSION#`).
  - [x] Fixed a real bug `listItems` would otherwise have shipped with: every item is
        now 3 physical rows, so the old `Scan` + `Limit` + `Count` approach would
        badly miscount/under-return. Now pages through `Scan` collecting all
        `latest`-record matches before paginating client-side.
  - [x] `dynamodb.test.ts` added using `aws-sdk-client-mock` — first place the actual
        AWS SDK call shapes (not just types) are exercised

- [ ] **7. SST v3 setup** (IaC-specific part still pending; handler layer below is
      IaC-agnostic and lives on `mjwheatley/main`, not the `mjwheatley/sst` branch —
      see "Branching" in `DECISIONS.md`)
  - [x] **Handler layer (IaC-agnostic, done on `main`):** all 7 handlers rewritten
        around a full REST middleware stack (`createMiddyfiedRestHandler`, ported from
        prior production work) — CORS, JSON body parsing, response serialization,
        structured logging (Powertools), error-to-JSON-response mapping, actor/logger
        metadata, Zod validation against the real structured `APIGatewayProxyEventV2`.
        API Gateway version decided: `ApiGatewayV2` (HTTP API) — see "API Gateway
        version" in `DECISIONS.md` for the v1 triggers (API keys, WAF) that would
        change this. `src/server.ts` removed (task 8 pulled forward — see
        `DECISIONS.md`). Full rationale/adaptations: "Task 7: full REST middleware
        stack" in `DECISIONS.md`.
  - [ ] `sst.config.ts`
  - [ ] DynamoDB table component (single-table design) — composite key `{ PK, SK }`,
        not the original single `{ id }` key (see task 6 / `DECISIONS.md`)
  - [ ] API Gateway routes for the 7 endpoints (6 from the brief +
        `GET /api/items/:id/versions`, added in task 6 — see `DECISIONS.md`), pointing
        at the handlers already built above
  - [ ] Function-defaults environment wiring (table name/endpoint/region, `ACCOUNT_STAGE`
        — see "Task 7: full REST middleware stack" in `DECISIONS.md`) via SST, not per-function
  - [ ] Per-stage config wired in via `StackConfiguration` (task 5)

- [x] **8. Remove `src/server.ts`** (pulled forward during task 7's handler rework —
      see `DECISIONS.md`)
  - [x] Delete `src/server.ts` and any now-unused local-server scaffolding/scripts
        (`start` script, `tsx` dependency)
  - [ ] Confirm `sst dev` actually covers the local dev loop against a real deploy —
        still pending an `AWS_PROFILE` with real deploy access (see pickup notes in
        `TIME_LOG.md`); everything up to `sst diff`'s AWS auth step has been verified

- [x] **9. ESLint config + pre-commit hook**
  - [x] Add `eslint.config.mjs`: `typescript-eslint` strict + stylistic type-checked base
  - [x] `import-x` ordering / no-extraneous-dependencies (test + `sst.config.ts`/`eslint.config.mjs`/
        `lint-staged.config.mjs` exceptions)
  - [x] `no-restricted-imports` (yup/lodash → prefer Zod)
  - [x] General style rules (padding-line-between-statements, id-length)
  - [x] `husky` + `lint-staged`: pre-commit runs `eslint --fix` scoped to staged
        `*.ts` files, plus whole-project `pnpm typecheck` and `pnpm test`
  - [x] Cleaned up all pre-existing lint errors surfaced across `src/server.ts`,
        `src/storage/dynamodb.ts`, `src/storage/memory.ts`, `src/handlers/example.ts`
        immediately (rather than deferring) — `eslint .`, `pnpm typecheck`, and
        `pnpm test` all pass clean. See "Immediate lint cleanup" in `DECISIONS.md`
        for what changed and why.

- [x] **10. Auth — Cognito — SKIPPED, deliberately, for time-box reasons**
  - Session 1 landed at ~3h20m net (see `TIME_LOG.md`), already past the brief's
    "1-3 hours" guidance before this task even started. Decided not to build it rather
    than rush Cognito wiring (User Pool + authorizer + token exchange) in the time
    remaining. `AuditEntry.changedBy` stays a self-reported, unauthenticated
    placeholder — see "Authentication (skipped — time box)" in `DECISIONS.md`, which already
    documents the intended shape if this gets picked up later.
  - [ ] ~~Cognito User Pool in IaC~~
  - [ ] ~~Manually onboard test user(s) via AWS console~~
  - [ ] ~~Credential → token exchange (custom endpoint or hosted UI — TBD)~~
  - [ ] ~~Cognito authorizer guarding the API routes~~
  - [ ] ~~Wire real caller identity into `AuditEntry.changedBy`~~

- [ ] **11. `ARCHITECTURE.md`** (next up)
  - [ ] Confirm `sst deploy`/`sst dev` actually works against a real AWS account
        (task 8's last open item) once an `AWS_PROFILE` with real deploy access is
        available, and that API Gateway routes actually hit the local/deployed code
  - [ ] Write up from `DECISIONS.md`: data model + DynamoDB schema, infra
        choices/rationale (including the SST v3 vs. CDK/Terraform deviation and the
        auth-skip decision above), scalability, security approach, trade-offs and
        future improvements
