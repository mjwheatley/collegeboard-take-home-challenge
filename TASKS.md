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

- [ ] **6. Single-table DynamoDB design**
  - [ ] Composite key: `PK = itemId`, `SK` prefixes (`latest`, `VERSION#000N`, `AUDIT#<ts>#000N`)
  - [ ] `updateItem`: `TransactWriteItems` writing `latest` + `VERSION#` snapshot + `AUDIT#` entry atomically
  - [ ] `createVersion` / `getAuditTrail` implemented against the new key design
  - [ ] `getAuditTrail` return type changes `ExamItem[] → AuditEntry[]` (update `ItemStorage` interface)
  - [ ] `AuditEntry` type (`itemId`, `version`, `action`, `changedBy`, `changedFields`, `timestamp`)
  - [ ] Field-diffing for `changedFields` (top-level fields: `subject`, `itemType`, `difficulty`, `content.*`, `metadata.status`, `metadata.tags`, `securityLevel`)

- [ ] **7. SST v3 setup**
  - [ ] `sst.config.ts`
  - [ ] DynamoDB table component (single-table design)
  - [ ] Lambda function(s) + API Gateway routes for the 6 endpoints
  - [ ] Function-defaults environment wiring (table name/endpoint/region) via SST, not per-function
  - [ ] Per-stage config wired in via `StackConfiguration` (task 5)

- [ ] **8. Remove `src/server.ts`**
  - [ ] Confirm `sst dev` covers the local dev loop
  - [ ] Delete `src/server.ts` and any now-unused local-server scaffolding/scripts

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

- [ ] **10. Auth — Cognito (stretch, time-boxed; may remain deferred)**
  - [ ] Cognito User Pool in IaC
  - [ ] Manually onboard test user(s) via AWS console
  - [ ] Credential → token exchange (custom endpoint or hosted UI — TBD)
  - [ ] Cognito authorizer guarding the API routes
  - [ ] Wire real caller identity into `AuditEntry.changedBy`

- [ ] **11. `ARCHITECTURE.md`**
  - [ ] Write up from `DECISIONS.md` once the above settles: data model + DynamoDB
        schema, infra choices/rationale, scalability, security approach, trade-offs
        and future improvements
