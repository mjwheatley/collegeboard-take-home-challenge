# Tasks

Working list for implementing the decisions in `DECISIONS.md`. Check items off as they
land; add new tasks as decisions are made rather than letting scope drift undocumented.

- [x] **1. tsconfig split**
  - [x] Replace `tsconfig.json` with a references-only file
  - [x] Add `tsconfig.lib.json` (Lambda source, excludes `*.test.ts`)
  - [x] Add `tsconfig.stacks.json` (`sst.config.ts` + IaC code) — on disk, not yet
        wired into root `references` (empty `include` fails `tsc --build`; wire in
        during task 7 once `sst.config.ts` exists)
  - [x] Add `tsconfig.test.json` (co-located `*.test.ts` files)
  - [x] Move `src/__tests__/example.test.ts` next to `src/handlers/example.ts`
  - [x] Update `vitest.config.ts` include pattern if needed — not needed, default
        glob already matches co-located `*.test.ts` anywhere

- [ ] **2. Consolidate `src/types/item.ts` with Zod**
  - [ ] Single `ExamItemSchema` (Zod) as source of truth for `content`/`metadata` shapes
  - [ ] `CreateItemRequest`/`UpdateItemRequest` as `.omit()`/`.partial()` derivatives
  - [ ] Types derived via `z.infer`, drop hand-written interfaces

- [ ] **3. Zod validation middleware**
  - [ ] Add Middy (`@middy/core`)
  - [ ] Small `zodValidatorMiddleware` (request + response schema validation)
  - [ ] Wire into handlers

- [ ] **4. `AccountStage` + stage resolution**
  - [ ] Local `AccountStage` enum: `Development | Staging | Production`
  - [ ] Minimal stage-resolution helper(s) (only what this project needs)

- [ ] **5. `StackConfiguration` per stage**
  - [ ] Scaled-down per-stage config (DynamoDB table name, region, log level, etc.)
  - [ ] Validate shape with Zod where useful

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

- [ ] **9. ESLint config**
  - [ ] Add `eslint.config.mjs`: `typescript-eslint` strict + stylistic type-checked base
  - [ ] `import-x` ordering / no-extraneous-dependencies (test + `sst.config.ts` exceptions)
  - [ ] `no-restricted-imports` (yup/lodash → prefer Zod)
  - [ ] General style rules (padding-line-between-statements, id-length)

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
