# Architecture

Summary of the design decisions behind this submission. The full reasoning, alternatives
considered, and implementation notes for everything below live in `DECISIONS.md`
(kept as a running log during the work) and `TASKS.md` (what landed, task by task) —
this document is the condensed version the brief asks for.

**Scope deviation, stated up front:** the brief asks for AWS CDK *or* Terraform. This
submission uses **SST v4** (Pulumi-based) instead — a deliberate choice to evaluate it
against prior production SST v2/CDK experience, not a misreading of the brief. See
"Infrastructure choices and rationale" below for what that means for validation
(`sst diff`/`sst deploy` instead of `cdk synth`/`terraform plan`) — this codebase has
since been deployed to and confirmed working against a live AWS account.

## System overview

A serverless exam-item management API: API Gateway (HTTP API v2) → Cognito JWT
authorizer → 7 Lambda functions (one per route) → a single DynamoDB table. Handlers are
built around a Middy middleware stack (validation, JSON parsing, CORS, structured
logging, error formatting) so the handler bodies only contain domain logic. IaC is SST
v4, split into one file per resource under `infra/resources/`.

```
Client → API Gateway v2 → Cognito JWT authorizer → Lambda (Middy stack) → DynamoDB
```

## Data model design and DynamoDB schema

**Single-table design.** One table, `PK = itemId`, with `SK` distinguishing three record
kinds that share a partition:

| SK | Holds |
|---|---|
| `latest` | Current full `ExamItem` |
| `VERSION#000N` | Full `ExamItem` snapshot as of version `N` (zero-padded so lexical sort matches numeric) |
| `AUDIT#<ISO timestamp>#000N` | Change-log entry for the transition to version `N` |

Two record kinds — version *snapshots* ("what did this look like") and an *audit trail*
("who changed what, when") — live side by side rather than collapsing into one, because
this domain (exam content with a `securityLevel` field and a draft→review→approved→
archived workflow) makes "who approved this" a distinct, valuable question from "what
changed." `createItem`/`updateItem`/`createVersion` each write `latest` + a version
snapshot + an audit entry in a single `TransactWriteItems` call, so the three can never
drift out of sync.

**Access patterns:**
- Get by id: `GetItem { PK: id, SK: 'latest' }` — O(1).
- List with `subject`/`status` filter: sparse GSIs. `latest` records (only) carry
  `GSI1PK`/`GSI1SK` (`subject` / `STATUS#<status>#<id>`) and `GSI2PK`/`GSI2SK` (`status`
  / `SUBJECT#<subject>#<id>`); a filtered list is a `Query` against the matching index,
  no further filtering needed since version/audit rows never get those attributes. An
  unfiltered list falls back to a bounded `Scan` — there's no selective key to query
  against for "everything."
- Version history / audit trail: single-partition `Query`s with `begins_with(SK, ...)`,
  newest-first.

**Known follow-up, not fixed:** `listItems`/`listVersions` fetch every matching record
then paginate client-side (`offset`/`limit`/exact `total` in the response), rather than
the idiomatic DynamoDB shape (`limit`/opaque cursor via `ExclusiveStartKey`, no exact
count). DynamoDB has no `skip` operation, so an offset-based API is fundamentally at
odds with efficient native pagination — this is a real MongoDB-vs-DynamoDB tradeoff
(Mongo trades predictable performance for arbitrary filter/sort/count flexibility;
DynamoDB trades that flexibility for consistent latency, but only for access patterns
designed in ahead of time via a GSI). Left as-is here since fixing it is an API-contract
change, not a bug fix — see `DECISIONS.md` for the full writeup.

**Types:** a single Zod schema (`ExamItemSchema`) is the source of truth for the item
shape; `CreateItemRequest`/`UpdateItemRequest` are `.omit()`/`.partial()` derivatives,
with TS types derived via `z.infer` rather than hand-maintained interfaces.
`itemType`/`metadata.status`/`securityLevel` are `z.enum(...)` of the brief's documented
values (not bare `string`); `difficulty` is bounded `1–5`.

## Infrastructure choices and rationale

**SST v4 (Pulumi) over CDK/Terraform** — see the scope deviation note above. Resources  
are split one-per-file under `infra/resources/` (`database.ts`, `api-gateway.ts`,
`auth.ts`), orchestrated by `sst.config.ts`, rather than one large stack file.

**API Gateway v2 (HTTP API), not v1 (REST API):** ~70% cheaper per request, lower
latency, and native JWT authorizer support (a Cognito User Pool's OIDC issuer works
directly as a JWT authorizer, no custom Lambda authorizer needed). Request/response
validation is already handled in the middleware stack, so REST API's JSON-Schema
validation models would be redundant here. Would reconsider for v1 if API keys +
usage plans (REST-API-only) or WAF became requirements — neither applies today.

**DynamoDB table:** `sst.aws.Dynamo` with `{ PK: string, SK: string }` as a
hash+range composite key, matching the schema above, plus `GSI1`/`GSI2` for the
sparse-index query patterns. `link: [table]` grants each Lambda's IAM role DynamoDB
access automatically; the storage layer still reads `DYNAMODB_TABLE_NAME` etc. from
`process.env` rather than importing SST's `Resource` object, so it stays
framework-agnostic and unit-testable without SST.

**Environment / stage configuration:** a local `AccountStage` enum
(`Development | Staging | Production`) plus a small `resolveAccountStage` helper maps
SST's raw `$app.stage` string (which includes every developer's personal `sst dev`
stage and every PR preview) down to one of three buckets for *behavioral* config only
(`AWS_REGION`, `LOG_LEVEL` — via `StackConfiguration`). Resource identity (the table
name) is deliberately kept out of this bucket-based config and derived from the raw
stage string directly, so two developers running `sst dev` concurrently don't collide
on the same hardcoded name.

**Validated against a real AWS account:** beyond `sst install`/`sst diff` (no
AWS-credential access from this working environment), this codebase has since been
deployed to a live AWS account and confirmed working end to end — `sst deploy`, the
provisioned API Gateway/Lambda/DynamoDB/Cognito resources, and the local dev loop
(`sst dev`) against that live infrastructure all check out.

## Security approach

**Authentication:** Cognito User Pool + Client (`infra/resources/auth.ts`), with a JWT
authorizer attached to every API Gateway route. `usernames: ['email']` makes email a
sign-in alias (so password reset can target it) without making it the immutable
username. Self-service sign-up is disabled
(`adminCreateUserConfig.allowAdminCreateUserOnly`) — accounts are provisioned manually,
not through public registration. No Cognito Identity Pool: nothing here needs
temporary AWS credentials for direct client-side SDK calls; the authorizer only needs
the User Pool's issuer URL and the Client ID as audience. API keys were considered as a
simpler alternative but identify a *client*, not a *user* — insufficient for a
per-user `AuditEntry.changedBy`, which is what actually drove the choice.

**Authorization:** every route requires a valid JWT; `actorLogMetadataMiddleware`
extracts the caller's identity from `requestContext.authorizer.jwt.claims` and attaches
it to structured logs and audit entries. `AuditEntry.changedBy` is now a verified caller
identity rather than a self-reported request-body field.

**Validation:** every request/response is Zod-validated (`zodValidatorMiddleware`) using
the same schemas that define the domain types, so runtime validation and compile-time
types can't drift apart.

**Error handling:** expected failures (`NotFoundError`, etc.) are thrown, not returned,
and formatted into a JSON error response by `jsonErrorMessageMiddleware`; unexpected
errors propagate the same way rather than being caught-and-swallowed, so they actually
reach structured error logging (Powertools) instead of silently becoming a generic 500
with no trace.

**Token exchange:** resolved in favor of Cognito's hosted UI, via a local dev tool
(`scripts/token-server/`) rather than a production client app — an Express server
(`app.js`) that drives the Authorization Code + PKCE flow against the User Pool
(`openid-client`, reading the deployed User Pool/Client IDs from `.sst/outputs.json`),
and a small UI (`views/home.ejs`) to display/copy the resulting access token for
manually crafted requests, plus a `/run-tests` route that feeds the token straight into
`scripts/integration-test.js`. This is the mechanism for *getting* a token during local
development/testing, not a production sign-in surface for the API's real clients — the
API itself has no login endpoint, callers are expected to authenticate against Cognito
directly.

## Scalability & performance considerations

- **DynamoDB access patterns are index-backed, not scan-based**, for every filtered
  read (`GSI1`/`GSI2`); only an unfiltered "list everything" falls back to a bounded
  `Scan`, which is the correct DynamoDB tradeoff — there's no way to avoid reading the
  full table for a truly unconstrained list.
- **Serverless throughout** (Lambda + HTTP API + DynamoDB): scales with request volume
  without capacity planning, at the cost of cold starts and per-request pricing —
  appropriate for an admin-style item-management API, not a high-throughput hot path.
- **Pagination is the known scaling gap** (see "Data model" above): correct today, but
  re-reads the entire matching result set on every call rather than one bounded page.
  This is the first thing to fix before this API would need to handle large item
  counts or high list-endpoint traffic.
- **HTTP API v2** was chosen partly for its lower per-request latency over REST API v1,
  on top of the cost difference.

## Trade-offs and future improvements

- **Cursor-based pagination** (see above) — the concrete next step, and the one
  genuinely deferred implementation gap rather than a deliberate scope cut.
- **Token issuance flow for real clients** — the hosted-UI + PKCE flow is proven end to
  end via the local `scripts/token-server/` dev tool, but that tool is a developer/tester
  convenience, not a production client integration. A real frontend would drive the
  same hosted-UI flow itself (or a native app would use PKCE directly) rather than
  going through this dev-only Express server.
- **CDK/Terraform comparison branch** — the SST choice was explicitly made as a
  from-scratch comparison against prior CDK-based SST v2 experience; a follow-up branch
  implementing the same infrastructure in CDK (per the brief's original framing) was
  considered but not started.
- **Real-account deploy and local dev loop** — both confirmed working: `sst deploy`
  against a live AWS account, and `sst dev` against that deployed infrastructure,
  including the Cognito-authorized API Gateway routes.
