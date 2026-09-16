# Architecture

This is the current-state description of the system on `mjwheatley/aws-cdk`. It's a
distillation of `DECISIONS.md` (the full reasoning/history log) — read that for *why*
each choice was made and what alternatives were rejected; this file just describes what
exists today.

## Overview

A REST API for managing exam items (multiple-choice/free-response questions), backed by
DynamoDB, deployed as API Gateway (HTTP API v2) + one Lambda per route, provisioned with
AWS CDK. Request/response validation is Zod; error handling, logging, CORS, and response
formatting are a Middy middleware stack.

```
API Gateway (HttpApi, 7 routes)
  └─ NodejsFunction per route ── src/handlers/items.ts (createMiddyfiedRestHandler)
                                     └─ src/storage/{dynamodb,memory}.ts (ItemStorage)
                                            └─ DynamoDB table (single-table design)
```

## Repository layout

Flat `src/` (single-app repo, no monorepo split). `infra/` holds all IaC and is
compiled as a separate TS project from Lambda source, so IaC-only code never leaks into
the deployable bundle:

- `tsconfig.lib.json` — Lambda source (`src/`, excludes tests)
- `tsconfig.test.json` — co-located `*.test.ts` files (`src/` and `infra/`)
- `tsconfig.stacks.json` — `infra/**/*.ts` (CDK app + resources)

Tests live next to the file they cover (`item.ts` + `item.test.ts`).

## Infrastructure (CDK)

- `infra/cdk-app.ts` — app entry point (run via `tsx`, no separate build step). Reads
  `--context stage=<name>` (default `dev`), instantiates `ItemChallengeStack`.
- `infra/item-challenge-stack.ts` — the single stack: resolves `AccountStage` and
  per-stage config from the raw `stage` string, then wires the table and API together.
- `infra/resources/database.ts` — `createExamItemsTable`: one DynamoDB table,
  `PAY_PER_REQUEST`, composite key `{PK, SK}`, plus sparse `GSI1`/`GSI2` (see "Data
  model" below). `RemovalPolicy` is `RETAIN` in production, `DESTROY` otherwise.
- `infra/resources/api-gateway.ts` — `createApi`: `HttpApi` (HTTP API v2, not REST API
  v1 — cheaper, lower latency, native JWT authorizer support if/when auth lands) with 7
  routes, each its own `NodejsFunction` (esbuild-bundled, no Docker), pointed at the
  matching export in `src/handlers/items.ts`. Shared env vars
  (`USE_DYNAMODB`, `DYNAMODB_TABLE_NAME`, `LOG_LEVEL`, `ACCOUNT_STAGE`) are set once and
  applied to every route's function. `table.grantReadWriteData(fn)` scopes IAM per
  function.
- `infra/stage.ts` / `infra/stack-configuration.ts` — IaC-agnostic: map the raw
  deploy-stage string to `AccountStage` (`Development | Staging | Production`) and to
  stage-*behavioral* config (`AWS_REGION`, `LOG_LEVEL`). Deliberately hold no
  resource-identity values (e.g. table name) — those come from the CDK-generated,
  stage-unique physical name instead, since `AccountStage` collapses many distinct raw
  stages (every developer's personal deploy) into one bucket.

Validated with `cdk synth` (fully offline, no AWS credentials needed) against all 7
routes, both GSIs, and per-function env vars in the rendered CloudFormation template.

## Local development

`src/server.ts` — a plain Node `http` server for `pnpm dev`/`pnpm start`, since CDK has
no live-Lambda-proxy equivalent to SST's `sst dev`. Builds a real, synthetic
`APIGatewayProxyEventV2` from each raw request (`routeKey`, `rawPath`, `rawQueryString`,
string `body`, `requestContext.http`, path parameters matched against the same 7 route
patterns the CDK stack registers) and feeds it straight into the unmodified Middy
handler chain — so the local path runs identical code to the deployed path. `OPTIONS`
preflight is answered directly in `server.ts` (normally API Gateway's job).

## Request handling: middleware stack

Every route in `src/handlers/items.ts` is wrapped by `createMiddyfiedRestHandler`
(`src/handlers/createMiddyfiedRestHandler.ts`), a Middy (`@middy/core`) composition:

1. `httpHeaderNormalizer` — normalize header casing
2. `httpJsonBodyParser` — parse JSON body (`disableContentTypeError: true`)
3. `resetLoggerKeysMiddleware` / `actorLogMetadataMiddleware` — structured logging
   context; the latter extracts a JWT `claims`-shaped actor from
   `requestContext.authorizer.jwt.claims` when a Cognito authorizer is present (currently
   always absent — see "Authentication" below), and is a safe no-op until then
4. `corsMiddleware` — CORS headers (`Access-Control-Allow-Origin: *` default — no known
   frontend origin yet, no cookies used, so this carries no credential-leak risk)
5. `responseHeadersMiddleware` — sets `Stage` header from `ACCOUNT_STAGE`
6. `zodValidatorMiddleware` (`src/middleware/zodValidatorMiddleware.ts`) — validates
   request against a Zod schema, and the single-success-shape response schema on the
   way out
7. `httpContentNegotiation` / `httpResponseSerializer` — content-type negotiation and
   serialization
8. `requestResponseLogger` — structured request/response/error logging
9. `jsonErrorMessageMiddleware` — catches thrown errors (`HttpError` subclasses like
   `NotFoundError`) and formats them as a JSON error response; `expose` hides the
   message in production

Handlers throw (`NotFoundError`, etc.) rather than catch-and-return, so
`requestResponseLogger`'s `onError` hook and Powertools structured error logging fire
for every unexpected failure.

## Types & validation

`src/types/item.ts` — a single Zod schema (`ExamItemSchema`) is the source of truth;
`CreateItemRequestSchema`/`UpdateItemRequestSchema` are derived variants
(`.omit()`/field-by-field `.partial()`). `itemType`, `metadata.status`, and
`securityLevel` are `z.enum(...)`; `difficulty` is bounded `z.number().int().min(1).max(5)`.
TS types are inferred via `z.infer`, never hand-duplicated.

## Data model: single-table design

One DynamoDB table, `PK = itemId`, `SK` distinguishing record kinds sharing that
partition:

| SK | holds |
|---|---|
| `latest` | current full `ExamItem` |
| `VERSION#0002` | full `ExamItem` snapshot as of version 2 |
| `AUDIT#<timestamp>#0002` | change-log entry for the transition to version 2 |

- `createItem`/`updateItem`/`createVersion` write `latest` + a version snapshot + an
  audit entry in one `TransactWriteItems` call, so the three can never drift out of sync.
- `getItem` is a single `GetCommand` on `{PK: id, SK: 'latest'}`.
- `listVersions`/`getAuditTrail` are single-partition `Query`s with `begins_with(SK, ...)`.
- `latest` records only also carry `GSI1PK`/`GSI1SK` (`subject` / `STATUS#<status>#<id>`)
  and `GSI2PK`/`GSI2SK` (`status` / `SUBJECT#<subject>#<id>`) — both indexes are sparse
  (only `latest` rows have these attributes), so `listItems` can `Query` by `subject`
  and/or `status` with no further filtering. With no filter, it falls back to a bounded
  `Scan` (`MAX_LIST_SCAN_PAGES`) collecting matching `latest` records before paginating
  client-side.
- `AuditEntry` (`src/types/audit.ts`) tracks `action: "created" | "updated" |
  "version_created"` and `changedFields: string[]`.

Implementation: `src/storage/single-table-keys.ts` (key builders), `src/storage/audit-diff.ts`
(pure field-diffing), `src/storage/dynamodb.ts` (the `ItemStorage` implementation),
`src/storage/memory.ts` (in-memory implementation for tests/local use, structurally
mirrored).

**Known follow-up:** `listItems`/`listVersions` pagination is "fetch everything matching,
then slice in memory" (offset/total-based), not DynamoDB's idiomatic forward-only cursor
(`limit`/`ExclusiveStartKey` → `nextCursor`). Correct today but re-reads the full matching
result set on every call. Left as-is because switching would drop `offset`/`total` from
the public API contract — see `DECISIONS.md` for the full tradeoff discussion (including
why this is a real Mongo-vs-DynamoDB pagination-model difference, not just a missing
feature).

## Authentication

**Not implemented** (time-boxed out). `AuditEntry.changedBy` is a self-reported,
unauthenticated placeholder (`metadata.author` from the request body) — treat any audit
trail output as provisional until this lands.

If/when built: a Cognito User Pool (manually onboarded users, no self-service sign-up),
JWT authorizer directly on the HTTP API v2 routes (no custom Lambda authorizer needed),
`actorLogMetadataMiddleware` already contains the claims-extraction logic and starts
working automatically once an authorizer is attached.

## Linting & pre-commit

`eslint.config.mjs` — `typescript-eslint` strict + stylistic type-checked rules,
`import-x` ordering, `no-restricted-imports` (yup/lodash → prefer Zod). `husky` +
`lint-staged` on `pre-commit`: `eslint --fix` on staged `*.ts` files, then whole-project
`pnpm typecheck` and `pnpm test` regardless of which files changed (single-package repo,
no per-project scoping available).
