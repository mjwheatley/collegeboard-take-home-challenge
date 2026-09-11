/**
 * Per-stage stack configuration
 *
 * Behavioral config only — values that vary by `AccountStage` bucket, not resource
 * identity. A DynamoDB table name (or anything else that needs to be unique per raw
 * SST stage, so concurrent personal `sst dev` stages don't collide) is deliberately
 * NOT here; it's derived from the actual stage string directly wherever the resource
 * is defined, not looked up by `AccountStage`.
 */

import { enum as zodEnum, object, string, type z } from 'zod';

import { AccountStage, resolveAccountStage } from './stage.js';

export const StackConfigurationSchema = object({
  AWS_REGION: string(),
  LOG_LEVEL: zodEnum(['DEBUG', 'INFO', 'WARN', 'ERROR']),
});

export type StackConfiguration = z.infer<typeof StackConfigurationSchema>;

const configByAccountStage: Record<AccountStage, StackConfiguration> = {
  [AccountStage.Production]: {
    AWS_REGION: 'us-east-1',
    LOG_LEVEL: 'INFO',
  },
  [AccountStage.Staging]: {
    AWS_REGION: 'us-east-1',
    LOG_LEVEL: 'INFO',
  },
  [AccountStage.Development]: {
    AWS_REGION: 'us-east-1',
    LOG_LEVEL: 'DEBUG',
  },
};

/** Looks up the behavioral config for whichever `AccountStage` bucket `stage` resolves to. */
export function getStackConfiguration(stage: string): StackConfiguration {
  return configByAccountStage[resolveAccountStage(stage)];
}
