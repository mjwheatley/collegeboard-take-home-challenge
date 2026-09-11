/**
 * Account stage
 *
 * SST allows an arbitrary stage name per deploy (a developer's personal `sst dev`
 * stage, a PR preview stage, `staging`, `production`, ...). `AccountStage` buckets
 * those raw stage strings into the handful of *behavioral* configurations this project
 * actually needs to distinguish between — it is not a resource-naming identifier.
 * Anything that needs per-developer/per-PR uniqueness (e.g. a DynamoDB table name)
 * must be derived from the raw stage string directly, not from this bucket, or two
 * developers running `sst dev` at the same time would collide on the same resource.
 */

export enum AccountStage {
  Development = 'dev',
  Staging = 'stg',
  Production = 'prd',
}

const NAMED_STAGE_ALIASES: Record<string, AccountStage> = {
  production: AccountStage.Production,
  prod: AccountStage.Production,
  prd: AccountStage.Production,
  staging: AccountStage.Staging,
  stage: AccountStage.Staging,
  stg: AccountStage.Staging,
  dev: AccountStage.Development,
};

/**
 * Resolves an arbitrary SST stage name to the `AccountStage` bucket whose config
 * should apply. Only the two named, long-running stages get their own bucket;
 * everything else (personal dev stages, PR previews, etc.) falls back to
 * `Development`.
 */
export function resolveAccountStage(stage: string): AccountStage {
  return NAMED_STAGE_ALIASES[stage.toLowerCase()] ?? AccountStage.Development;
}
