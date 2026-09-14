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

**Package version:** `sst@4.17.1` (latest) is installed, not a `3.x` release. Per SST's
own migrate-from-v3 guide, this doesn't change the comparison being made here — v4's
component API (`sst.aws.*`, `$config`, `.link()`) is the same "Ion" architecture as v3;
the major bump is about upgrading the underlying Pulumi AWS provider (v6 → v7), plus a
few internal renames (dropping an S3 resource's `V2` suffix, `tags` → `tagsAll`). None
of that affects what's being evaluated here (this Pulumi/component-based approach vs.
the CDK-based SST v2 experience), so latest was used rather than pinning to `3.19.3`.

**Note on the upstream repo:** as of this install, the GitHub org for the `sst` project
has moved from `sst/sst` to `anomalyco/sst` — noted here only because it surprised the
research process; it doesn't affect anything about this project's usage of the package.

**Branching:** `mjwheatley/sst` was branched from `mjwheatley/main` at the start of
task 7, specifically so a second branch (`mjwheatley/aws-cdk` or similar) can later
implement the same infrastructure with AWS CDK for a side-by-side comparison, per the
brief's original "CDK or Terraform" framing. In practice, task 7 turned out to have an
IaC-agnostic part (the handler/middleware layer — real API Gateway event handling,
error formatting, logging, etc., none of which cares whether CDK, Terraform, or SST
provisions the underlying resources) and an IaC-specific part (`sst.config.ts` itself).
The agnostic part was moved back to `mjwheatley/main` (so a future CDK/Terraform branch
starts from the same handler code, rather than having to re-derive or cherry-pick it
from `mjwheatley/sst`); `mjwheatley/sst` fast-forwards to include it and then continues
with the SST-specific `sst.config.ts` work.

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

**API Gateway version: `sst.aws.ApiGatewayV2` (HTTP API), not `ApiGatewayV1` (REST API).**

**Decision:** Use HTTP API (`ApiGatewayV2`).

**Rationale:** ~70% cheaper per request and lower latency than REST API; native JWT
authorizer support fits the Cognito auth plan directly (a Cognito User Pool's OIDC
issuer works as a JWT authorizer without a custom Lambda); request/response validation
is already handled by `zodValidatorMiddleware` (task 3), so REST API's built-in
JSON-Schema request-validation models would be redundant here anyway. This is also
SST's own recommended default for new APIs.

**When v1 (REST API) would actually be needed instead:**
- **API keys + usage plans** (per-client rate limiting) — this is a REST-API-only
  feature. It's specifically the auth fallback noted in "Authentication (skipped — time box)"
  above ("API keys... as a simpler fallback") — if that fallback is ever exercised
  instead of Cognito, it would require switching this to `ApiGatewayV1`.
- **WAF** — REST APIs support WAF (classic and WAFv2) directly; HTTP API v2's WAF
  support is comparatively newer/more limited depending on the AWS region and setup.
  If a WAF requirement comes up later, that's the other trigger to reconsider v1.

Neither applies today (auth plan is Cognito-first, no WAF requirement), so `ApiGatewayV2`
is the right call for now — but both are documented here as the specific, concrete
reasons to revisit this choice, not a vague "maybe v1 someday."

## Environment / stage configuration

**Decision:** Port the *shape* of a `StackConfiguration` pattern (a
`Record<AccountStage, {...}>` per-stage config object, validated where possible with
Zod), scaled down to what this project actually needs.

**`AccountStage`:** `Development | Staging | Production`, with 3-letter env-style
string values (`dev`/`stg`/`prd`) rather than the full words. The source pattern this
is based on relies on an `AccountStage` enum and stage-resolution helpers
(e.g. `getLongRunningStage`, `isProductionLikeStage`) from a private shared library this
repo has no access to — those are being rolled by hand
(`infra/stage.ts`, `resolveAccountStage`), scoped to just the three stages above and
only the resolution logic this project actually needs, rather than reimplementing the
whole library.

**`infra/` directory:** `AccountStage`/`resolveAccountStage`/`StackConfiguration` live
under a new top-level `infra/` directory, not `src/`, and are covered by
`tsconfig.stacks.json` (`sst.config.ts` + IaC code — see "Repository layout"). They're
IaC-time concerns: `sst.config.ts` (task 7) will read them to decide what to deploy and
what env vars to hand Lambda functions, but the Lambda code itself never imports them —
it just reads `process.env` (see `src/storage/dynamodb.ts`). Adding real files here
also meant `tsconfig.stacks.json` was no longer an empty project (`include:
["sst.config.ts", "infra/**/*.ts"]` now matches something even without `sst.config.ts`
existing yet), so it got wired into the root `tsconfig.json`'s `references` ahead of
schedule — `tsconfig.test.json`'s `include`/`references` were broadened to cover
`infra/**/*.test.ts` too, alongside `src/**/*.test.ts`.

**Resource identity is deliberately excluded from `StackConfiguration`:** the original
plan (see "Environment / stage configuration" history) considered including a DynamoDB
table name here, bucketed by `AccountStage` — that would be a real bug: `AccountStage`
collapses many distinct raw SST stage strings (every developer's personal `sst dev`
stage, every PR preview) into a single `Development` bucket, so two developers running
`sst dev` at the same time would resolve to the *same* hardcoded table name and stomp on
each other's data. `StackConfiguration` (`infra/stack-configuration.ts`) is scoped to
genuinely stage-*behavioral* values only (currently `AWS_REGION`, `LOG_LEVEL`); anything
needing per-stage uniqueness gets derived from the raw stage string directly wherever
that resource is defined (task 7), never looked up through this config.

**Env vars for Lambda handlers:** Whatever `StackConfiguration` ends up covering (plus
resource identifiers derived separately, like the DynamoDB table name) will be set once
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

**Implemented shape (`src/types/item.ts`):** `ExamItemSchema` is the base; nested
`ExamItemContentSchema`/`ExamItemMetadataSchema` objects are defined once and reused.
`CreateItemRequestSchema` = `ExamItemSchema.omit({ id, metadata }).extend({ metadata:
<metadata omit created/lastModified/version> })` (those three are server-generated, not
client-supplied). `UpdateItemRequestSchema` is built field-by-field rather than a plain
`ExamItemSchema.omit({id:true}).partial()`, because a shallow `.partial()` would make
`content`/`metadata` themselves optional but still require *all* of their nested fields
whenever present — the original hand-written `UpdateItemRequest` allowed a partial
`content`/`metadata` (e.g. update just `metadata.status`), so `content`/`metadata` are
built as `<nested schema>.partial().optional()` to preserve that.

**Scope decision beyond pure consolidation:** `itemType`, `metadata.status`, and
`securityLevel` — previously typed as plain `string` despite the README documenting a
fixed set of allowed values in comments — are now `z.enum(...)` of those documented
values, and `difficulty` is now bounded `z.number().int().min(1).max(5)` instead of a
bare `number`. This goes slightly beyond "consolidate duplicate shapes" into "add real
validation," but it's exactly what the brief asks for ("proper error handling and
validation") and costs nothing extra once the schema exists — leaving them as bare
`string`/`number` would mean the Zod schema *looks* like validation without actually
validating the one thing most likely to be wrong (a typo'd status/itemType value).
`subject` stays a free-form string (open-ended: "AP Biology", "AP Calculus", etc. — not
a fixed set).

**Consequence:** `src/handlers/example.test.ts`'s inline test fixtures needed `satisfies
CreateItemRequest` added — without it, TS widens object-literal string fields (e.g.
`itemType: "multiple-choice"`) to plain `string` before checking them against the
now-enum-typed parameter, and errors even though the literal value is valid.

**Import style:** `import { object, string, number, enum as zodEnum, type z } from
'zod'` (named function imports, `z` imported type-only for `z.infer`) instead of `import
{ z } from 'zod'` + `z.object(...)`/`z.string()`. `enum` needs the `as zodEnum` alias
since it's a reserved word. Array fields use `string().array()` (chained off the
element schema) rather than a top-level `array(string())` import.

## Middleware

**Decision:** Port a minimal middleware pattern seen in prior work — specifically Zod
request/response validation as a Middy (`@middy/core`) middleware — rather than a full
middleware stack (CORS, metrics, tracing, feature flags, etc.), most of which depends on
infrastructure this project doesn't have (observability tooling, feature-flag service).

**Rationale:** The brief calls for "proper error handling and validation" — a small
Zod validation middleware is directly reusable in shape; other cross-cutting concerns
(observability, feature flags) are out of scope here.

**Implemented shape (`src/middleware/zodValidatorMiddleware.ts`):** Generic over
`<TEvent, TResult>`; `before` replaces `request.event` with `requestSchema.parse(...)`,
`after` replaces `request.response` with `responseSchema.parse(...)` when a response
exists. A failing `.parse()` throws a `ZodError`, which Middy propagates as the
handler's error like any other thrown error — no special error-formatting was added,
since this project has no HTTP layer yet to decide how a `ZodError` should map to a
status code (that's a task 7 concern, once real API Gateway routes exist).

**Event-shape boundary (important, and worth getting right before task 7):** Wiring
Middy onto a handler forces a decision about what "the event" actually is, and this
project isn't deployed yet — there's no real API Gateway event to validate. Rather than
guess at API Gateway's HTTP API v2 payload shape now, `getItemHandler`'s and
`createItemHandler`'s Middy "event" is the **already-normalized domain payload** —
`{ id: string }` for a get-by-id, the `CreateItemRequest` fields directly for create —
not a raw `APIGatewayProxyEventV2`. This means `getItemHandler`'s signature changed
from `(id: string)` to `(event: { id: string }, context)`, and callers changed
accordingly (see below). Task 7 will decide the real mapping from an API Gateway event
to this shape (most likely a small adapter middleware in front of
`zodValidatorMiddleware` in the chain — e.g. extracting `pathParameters`/parsed `body`
into this normalized object — rather than reshaping these handlers again).

**Response schemas are exact per-status-code, not a loose `number()` catch-all:** e.g.
`getItemResponseSchema` is a `union` of `{statusCode: literal(200), body: ExamItemSchema}
| {statusCode: literal(404), body: errorBodySchema} | {statusCode: literal(500),
body: errorBodySchema}` — mirroring the handler's actual return type exactly, rather
than `{statusCode: number(), body: errorBodySchema}` as a generic error branch. This
isn't just precision for its own sake: `zodValidatorMiddleware`'s generic
`responseSchema: ZodType<TResult>` means the schema's inferred output type has to be
structurally assignable to the handler's actual `TResult` (`Awaited<ReturnType<typeof
getItem>>`) for the code to typecheck — a generic `number()` branch is *wider* than the
literal `404 | 500` the function actually returns, so it wouldn't be assignable back
into `TResult` on `request.response = responseSchema.parse(...)`.

**Consequence — call-site signature changes:** `getItemHandler`/`createItemHandler` now
take `(event, context)` instead of a bare value, since Middy's `MiddyfiedHandler` type
requires both. `src/server.ts` and `src/handlers/example.test.ts` pass a stub
`{} as Context` (from `@types/aws-lambda`, added as a dev dependency purely because
`@middy/core`'s own type definitions import `Context`/`Handler` from the `aws-lambda`
module) since neither has a real Lambda context to supply. `middy<TEvent, TResult>(...)`'s
generics don't get inferred from a bare arrow function due to its multi-overload
signature (`LambdaHandler | MiddlewareHandler | PluginObject`), so the inner handler
function's parameter needed an explicit type annotation in a few spots (`TS7006`
otherwise) even though the outer `middy<...>()` call already states the same type.

## Task 7: full REST middleware stack (supersedes the task-3 event-shape design)

**Decision:** Adopted the `createMiddyfiedRestHandler`/`createMiddyfiedHandler` pattern
from prior production work (a payment-processing API), porting every middleware in
that composition **except `featureFlagMiddleware`** (this project has no feature-flag
service) — CORS, actor/logger metadata, response headers, header normalization, JSON
body parsing, error-to-JSON-response mapping, content negotiation, response
serialization, structured request/response/error logging, and Zod validation.

**This supersedes, rather than extends, the task-3 "normalized domain payload" event
design.** Task 3 deliberately avoided guessing at API Gateway's real event shape by
inventing a flat, already-normalized event object (`{ id: string }`,
`CreateItemRequest` directly) and a hand-rolled `http-adapter.ts`
(`adaptApiGatewayEvent`/`formatApiGatewayResponse`/`toWebHandler`) to bridge a real
event to that shape. Adopting this reference pattern made that bridge **redundant**:
`@middy/http-json-body-parser` + `@middy/http-response-serializer` already do exactly
that job, tested in production. `http-adapter.ts` and its test were deleted; handlers
now take the real (structured) event directly.

**New dependencies added:** `@aws-lambda-powertools/logger` (structured logging —
`resetLoggerKeysMiddleware`/`actorLogMetadataMiddleware` need a real Powertools
`Logger` instance, not a duck-typed stand-in, since they call
`injectLambdaContext`/`.appendKeys()`/`.resetKeys()`), `@middy/http-cors`,
`@middy/http-header-normalizer`, `@middy/http-json-body-parser`,
`@middy/http-content-negotiation`, `@middy/http-response-serializer`, `@middy/util`.

**What had to be adapted, not copied — the source pattern leans on private packages
this repo has no access to** (`@team-and-tech/aws-config-utils`,
`@trajector/common-types`, `@webdeveric/utils`, `@trajector/node-lambda-logger`):
- `StatusCode` enum, `HttpError`/`NotFoundError`/`RequestTimeoutError` classes, and
  `getErrorDetails`/`removeStackProperty` (recursively extracting an Error's own
  properties, since `JSON.stringify(error)` omits them by default) were all
  reimplemented locally and simplified (no deep `AggregateError`/multi-error-array
  handling — this project's error model doesn't need it).
- `AccountStage` comparisons (`process.env['SST_STAGE'] === AccountStage.Production`)
  became `process.env.ACCOUNT_STAGE === 'prd'` — a plain string compare against our own
  3-letter stage codes (`infra/stage.ts`), not an import of the `infra/` module into
  runtime code (which would violate the `src`/`infra` boundary from "Repository
  layout" — `infra/` isn't part of `tsconfig.lib.json`'s project). `ACCOUNT_STAGE` is a
  **new env var task 7's remaining `sst.config.ts` work needs to set** via SST's
  function defaults (derived from `resolveAccountStage($app.stage)`) — absent today, so
  every default resolves as if not-production (the right default for local dev/tests).
- **API Gateway version**: the source pattern's types (`APIGatewayProxyEvent`,
  `APIGatewayProxyResult`, `WithPathParameters<... extends APIGatewayProxyEvent ...>`)
  are all v1 (REST API); this project uses v2 (HTTP API — see the "API Gateway version"
  decision above), so every type was ported as the v2 equivalent
  (`APIGatewayProxyEventV2`, `APIGatewayProxyStructuredResultV2`,
  `APIGatewayEventRequestContextJWTAuthorizer`'s `jwt.claims` shape for
  `actorLogMetadataMiddleware`'s actor extraction instead of v1's `requestContext.authorizer`).
- `corsMiddleware` reads an env var for the allowed-origins allowlist; there's no known
  SPA/frontend origin for this project yet, so it defaults to `["*"]` rather than the
  source's fail-closed empty array (no cookies are ever used per the deferred auth
  plan, so a permissive CORS default carries no credential-leak risk).
- `responseHeadersMiddleware` was ported as the generic, reusable middleware; its
  specific header values in the source (`Server`, `Build-Data` — built from
  `GITHUB_SHA`/`GITHUB_REF`/a CI build timestamp) were dropped since this project has
  no CI pipeline producing that metadata. Only `Stage` (from `ACCOUNT_STAGE`) is set.
- **`awsLambdaInvokeStore` and `okResult` were deliberately not ported** — the former
  has zero consumers anywhere in this codebase (it exists in the source to support
  other cross-cutting code that reads from its `AsyncLocalStorage`-backed store, which
  this project doesn't have); the latter is a `{statusCode: 200, ...}` convenience
  wrapper this project's explicit-envelope handler style doesn't need.
- `requestResponseLogger` *was* ported as-is (no private-package dependency beyond the
  logger itself).

**Response schema design changed along with the event shape.** Task 3's response
schemas were status-code-tagged unions (`literal(200)|literal(404)|literal(500)`)
because errors were *returned*, not thrown. Now that expected failures throw
`NotFoundError` (caught by `jsonErrorMessageMiddleware`, which formats the JSON error
response and bypasses `responseSchema` entirely — Middy routes a thrown error straight
to `onError`, skipping the remaining `after` hooks including `zodValidatorMiddleware`'s),
each handler's `responseSchema` only needs to validate its **single success shape**
(e.g. `object({statusCode: literal(200), body: ExamItemSchema})`) — no union needed.
Handlers needing a non-`200` success status (`createItem`, `createVersion`: `201`) still
return an explicit `{statusCode, body}` envelope rather than a bare value, since Middy's
`normalizeHttpResponse` only defaults to `200` for a bare value — there's no way to
express "succeeded with 201" other than the explicit envelope. This mirrors a mix of two
styles actually present in the reference codebase (bare-value-success-plus-throw for
always-200 handlers; explicit-envelope-for-every-branch for handlers needing other
success codes) — this project uses the explicit envelope uniformly across all 7 handlers
for consistency, combined with throwing `NotFoundError` for the not-found case (the
source's plain-envelope-only handlers skip `responseSchema` validation entirely on
their error branches; ours doesn't need to, since errors never reach it).

**No catch-all try/catch in handler bodies anymore.** Task 3/6's handler functions each
wrapped their body in `try { ... } catch { return {statusCode:500, ...} }`. That's
removed: catching-and-returning-a-plain-object instead of rethrowing meant
`request.error` was never set, so `requestResponseLogger`'s `onError` hook (and thus
Powertools' structured error logging) never actually fired for unexpected failures —
a real regression once this logging infrastructure existed to catch them. Unexpected
errors now propagate naturally; `jsonErrorMessageMiddleware` formats them into a 500
JSON response exactly like it does for `NotFoundError`, just with `expose` defaulting
to hiding the message once deployed to `prd`.

**`createMiddyfiedRestHandler` is deliberately non-generic / loosely typed**
(`requestSchema?: ZodType<unknown>`, not `ZodType<TEvent>` parameterized to match a
specific handler's hand-written event type) — matching the source pattern exactly.
Trying to make Zod's inferred schema-output type line up exactly with a hand-written
`WithPathParameters<...>`-style type turned out to be more type-system fighting than
it's worth (see the many now-reverted attempts at parameterizing this generically);
runtime validation is what actually enforces correctness, and the hand-written type is
documentation for the handler body, not something TS cross-checks against the schema.

**Test-fixture gotcha worth remembering:** `@middy/http-json-body-parser` throws a 422
if `body` is `undefined` **whenever its content-type check passes** — but
`disableContentTypeError: true` (set in `createMiddyfiedRestHandler`) only suppresses
the error on a content-type *mismatch*, not on a genuinely missing body. A GET request
fixture that (incorrectly) sets `content-type: application/json` with no body will
422; a real GET request wouldn't send that header at all (no body to describe), which
is what makes the content-type check fail and `disableContentTypeError` skip parsing
entirely. `items.test.ts`'s `fakeEvent` helper only sets that header when a body is
actually provided, to match.

**`server.ts` removal (task 8) pulled forward.** The starter's local dev server
constructed plain Node `http` requests and called handlers with the task-3 normalized
shape directly. Handlers now require a real, fully-structured `APIGatewayProxyEventV2`
(`pathParameters`, `requestContext`, `headers`, etc.) — reasonably faking that shape by
hand in `server.ts` for code about to be replaced by `sst dev` wasn't worth doing.
Deleted `src/server.ts`; `package.json`'s `dev` script is now `sst dev`, `start` was
removed (no more `dist/server.js`), and the now-unused `tsx` dev dependency was removed.

## Data model: single-table design for versions + audit trail

**Endpoint naming discrepancy — resolved by adding `GET /api/items/:id/versions`:** The
brief's route list has `POST /api/items/:id/versions` (create a version) but no
matching `GET /api/items/:id/versions` — only `GET /api/items/:id/audit`. Taken
literally, that would make "audit" the only read path for version history, conflating
two different concepts: *version history* ("what did this item look like at each point
in time" — full snapshots) and *audit trail* ("who changed what, when" — a change log).
Rather than pick one at the other's expense, both now exist as separate `ItemStorage`
methods: `getAuditTrail(id)` (the change log, `AuditEntry[]`) stays behind `/audit`, and
a new `listVersions(id, query)` — paginated the same way as `GET /api/items`, via the
same `PaginationQuery` type — returns full `ExamItem[]` snapshots and is what
`GET /api/items/:id/versions` (added to task 7's route list) will call. This also
means the original literal reading of `getAuditTrail(): Promise<ExamItem[]>` is now
satisfied too, just split across two purpose-built methods instead of one overloaded
one.

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

**`AuditEntry` shape (`src/types/audit.ts`, implemented):**

```ts
{
  itemId: string;
  version: number;
  action: "created" | "updated" | "version_created";
  changedBy: string;       // see auth note below — placeholder until real identity exists
  changedFields: string[]; // e.g. ["metadata.status", "content.correctAnswer"]
  timestamp: number;
}
```

`action` grew a third value beyond the original `"created" | "updated"` sketch:
`"version_created"` maps 1:1 to the `createVersion` storage operation (the explicit
`POST /api/items/:id/versions` bump — same item, no field changes, just a new version
number), which is a distinct thing from `updateItem`'s `"updated"` (field changes,
version bump as a side effect). Collapsing both into `"updated"` would make
`changedFields: []` ambiguous (did nothing change, or did we just not compute the
diff?) — a real audit-log consumer needs to tell those apart.

**Implementation (`src/storage/`):**
- `single-table-keys.ts` — `buildLatestKey`/`buildVersionKey`/`buildAuditKey` (zero-padded
  version numbers so lexical sort matches numeric sort; audit keys prefixed with an ISO
  timestamp so a `Query` returns them in chronological order) and `stripKeys` (drops
  `PK`/`SK` before returning a record to callers).
- `audit-diff.ts` — `diffExamItemFields(existing, data)`: compares only the fields
  actually present in an `UpdateItemRequest` against the current item, and only flags a
  field if the value actually differs (re-sending the same value isn't a "change").
  Pure and unit-tested independent of any storage backend.
- `dynamodb.ts` — every state-changing operation (`createItem`, `updateItem`,
  `createVersion`) writes `latest` + the version snapshot + the audit entry via a single
  `TransactWriteCommand`, so the three can never drift out of sync. `getItem` is a plain
  `GetCommand` on `{PK: id, SK: 'latest'}` — O(1), no `Query` needed. `listVersions`/
  `getAuditTrail` are single-partition `Query`s with `begins_with(SK, ...)`, sorted
  newest-first (`ScanIndexForward: false`).
- **Table schema change:** the physical primary key changes from a single `{ id }` hash
  key to a composite `{ PK, SK }` hash+range key — this is what task 7's actual table
  definition needs to match. `id` (the item id) is still stored as a regular attribute
  on every record, just no longer *is* the key.
- **`listItems` bug avoided, not just "changed":** every item is now 3 physical rows
  (latest/version/audit) sharing a partition instead of 1. The original `Scan` +
  `Limit` + `Count` approach would have been actively wrong here — `Limit` caps items
  *read* per page before `FilterExpression` runs, and `Count` reflects post-filter
  matches *within that page only*, so a table where 2/3 of rows are non-`latest` could
  return a `total` far lower than reality, or zero items on a page that happened to
  scan mostly `VERSION#`/`AUDIT#` rows. Fixed by paging through `Scan` (bounded by
  `MAX_LIST_SCAN_PAGES`, since this is a full scan, not a `Query`) collecting all
  filter-matching `latest` records first, then paginating client-side — correct
  `total`, at the cost of scanning more than strictly necessary.
- **`listItems` now Queries instead of Scans when a filter is given:** `latest`
  records (only) also carry `GSI1PK`/`GSI1SK` (`subject` / `STATUS#<status>#<id>`)
  and `GSI2PK`/`GSI2SK` (`status` / `SUBJECT#<subject>#<id>`) — see
  `single-table-keys.ts`. Since `VERSION#`/`AUDIT#` rows never get these attributes,
  both indexes are sparse and contain exactly the `latest` rows, so a `Query` against
  either needs no further filtering. `subject` (optionally + `status` via
  `begins_with` on `GSI1SK`) queries `GSI1`; `status` alone queries `GSI2`. With
  *no* filter there's no selective key to query, so `listItems` falls back to the
  bounded `Scan` described above — full-table listing has no way around a full-table
  read in this design. These GSIs aren't provisioned in IaC yet — this repo's `main`
  doesn't define the table's IaC at all yet (tracked on a separate branch) — so this
  is app-side key design only; the `Query` calls will fail against a table lacking
  `GSI1`/`GSI2` until that IaC lands.
- **`listItems` pagination is still "fetch everything, then slice" — a known
  follow-up, not the idiomatic DynamoDB pattern.** Even after the `GSI1`/`GSI2` change
  above, `queryIndex`/`scanAllLatestItems` each loop internally on `ExclusiveStartKey`
  until they've drained every matching page, and `listItems` only applies the caller's
  `offset`/`limit` afterward, in memory, over that fully-collected array (`total` is
  just `matched.length`). This works and is correct (modulo the `MAX_LIST_SCAN_PAGES`
  cap on the no-filter path), but it re-reads the *entire* matching result set on every
  call rather than fetching one bounded page.
  - **The idiomatic DynamoDB shape** would drop `offset`/`total` entirely in favor of a
    forward-only opaque cursor: request `{ limit?, cursor? }`, pass `limit` straight
    through as `Limit` on the `QueryCommand`/`ScanCommand`, pass the decoded `cursor` as
    `ExclusiveStartKey`, and return `{ items, nextCursor? }` where `nextCursor` is the
    page's `LastEvaluatedKey` (encoded), present only if more results exist. No
    `Limit`-sized DynamoDB call ever reads more than one page.
  - **Why this is a real, not cosmetic, redesign:** DynamoDB has no `skip`/`offset`
    operation — `ExclusiveStartKey` only supports "continue from exactly here," so an
    offset-based API is fundamentally incompatible with efficient native pagination;
    reaching "page 47" cold still costs 46 sequential reads no matter what, offset or
    cursor. Likewise, an exact `total` requires reading every matching item — identical
    cost to `Select: 'COUNT'` — so it's dropped in favor of `nextCursor`'s presence
    signaling "more may exist" (`hasMore`).
  - **Comparison point — this is a real MongoDB-vs-DynamoDB tradeoff, not just a
    missing feature.** MongoDB's `collection.find(query).sort(...).skip(...).limit(...)`
    plus a separate `countDocuments(query)` gives real random-access paging (jump to any
    page) and an exact count, for *any* query shape, because Mongo can index fields
    after the fact and its cursor model supports `skip`. DynamoDB requires the access
    pattern (which fields you filter/sort by) to be baked into a `Query`-able key
    (`GSI1`/`GSI2` here) ahead of time, has no `skip`, and has no cheap count. Mongo
    trades that flexibility for less predictable performance at scale (a `skip` deep
    into a large result set, or an unindexed `sort`, degrades quietly); DynamoDB trades
    away the flexibility for consistent, predictable latency, but only for the access
    patterns you explicitly designed indexes for. For an admin-style search/reporting
    UI where filters, sort fields, and exact counts are all expected to be arbitrary,
    Mongo's model is a legitimately better fit than forcing that shape onto DynamoDB.
  - **Scope note:** not implemented — `listVersions` shares the same `PaginationQuery`
    type and has the identical "drain then slice" shape in `dynamodb.ts`, and
    `MemoryStorage` would need an equivalent (but different — no native
    `LastEvaluatedKey` equivalent over a `Map`) cursor design to keep both
    `ItemStorage` implementations consistent. Left as a follow-up given the scope of an
    API-contract change (drops `offset`/`total` from `ListItemsQuerySchema` and the
    `listItemsHandler`/`listVersionsHandler` response schemas in `src/handlers/items.ts`).
- **`MemoryStorage` asymmetry with `DynamoDBStorage`:** `MemoryStorage` keeps a
  `versions: Map<string, ExamItem[]>` (full snapshots, mirroring `VERSION#` records)
  now that `listVersions` actually reads one — this was previously simplified away
  (see the task 3 commit) back when nothing in the interface consumed it.
- **Tests:** `audit-diff.test.ts`, `single-table-keys.test.ts` (pure logic, no AWS).
  `dynamodb.test.ts` uses `aws-sdk-client-mock` (`mockClient(DynamoDBDocumentClient)`)
  to assert on the actual `TransactWriteCommand`/`GetCommand`/`QueryCommand`/
  `ScanCommand` shapes sent — e.g. that `createItem` sends exactly 3 `TransactItems`
  with the right `SK`s, and `updateItem`'s audit entry has the right `changedFields`.
  This is the first place AWS SDK call shapes are actually exercised, rather than just
  typechecked.

## Authentication (skipped — time box)

**Decision (final for this submission):** Not implemented. Task 10 was explicitly
skipped rather than rushed: session 1 landed at ~3h20m net actual work (see
`TIME_LOG.md`), already past the brief's "1-3 hours" guidance before auth work would
even have started. `AuditEntry.changedBy` remains a self-reported, unauthenticated
placeholder (`metadata.author` from the request body) — a known, deliberate gap, not an
oversight.

**The shape this would have taken, if time allowed:** Cognito, with manual user
onboarding as the *provisioning* mechanism for it (not an alternative to it) — provision
a Cognito User Pool in IaC; onboard users manually via the AWS console (no self-service
sign-up, avoiding a programmatic seeding step); users authenticate with
username/password to obtain an access token (either via a custom auth endpoint that
does the exchange, or Cognito's hosted UI) and send that token in the API's
`Authorization` header; endpoints guarded by a Cognito authorizer (HTTP API v2 supports
this via a JWT authorizer directly — see "API Gateway version" above — no custom
Lambda authorizer needed). API keys were considered as a simpler fallback, but identify
a *client*, not a *user* — insufficient for a per-user `changedBy` on audit entries, so
Cognito was always the intended real answer, not API keys.

**Consequence for what's already built:** `actorLogMetadataMiddleware` (see "Task 7:
full REST middleware stack") already contains the claims-extraction logic for exactly
this Cognito JWT shape (`requestContext.authorizer.jwt.claims`) — it was built to be a
safe no-op until an authorizer exists, specifically so this gap could be closed later
without revisiting that middleware. Closing this gap means: add the Cognito resources to
`infra/resources/` (a new `auth.ts`, following the same one-file-per-resource pattern as
`database.ts`/`api-gateway.ts`), attach a JWT authorizer to the routes in
`api-gateway.ts`, and the actor metadata starts flowing automatically.

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
  source (see "Authentication (skipped — time box)" above).
