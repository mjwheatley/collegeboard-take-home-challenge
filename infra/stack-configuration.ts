/**
 * Per-stage stack configuration
 *
 * Behavioral config only — values that vary by `AccountStage` bucket, not resource
 * identity. A DynamoDB table name (or anything else that needs to be unique per raw
 * SST stage, so concurrent personal `sst dev` stages don't collide) is deliberately
 * NOT here; it's derived from the actual stage string directly wherever the resource
 * is defined, not looked up by `AccountStage`.
 */

import { enum as zodEnum, object, type z } from 'zod';

import { AccountStage, resolveAccountStage } from './stage.js';

export const StackConfigurationSchema = object({
  LOG_LEVEL: zodEnum(['DEBUG', 'INFO', 'WARN', 'ERROR']),
});

export type StackConfiguration = z.infer<typeof StackConfigurationSchema>;

const configByAccountStage: Record<AccountStage, StackConfiguration> = {
  [AccountStage.Production]: {
    LOG_LEVEL: 'INFO',
  },
  [AccountStage.Staging]: {
    LOG_LEVEL: 'INFO',
  },
  [AccountStage.Development]: {
    LOG_LEVEL: 'DEBUG',
  },
};

/** Looks up the behavioral config for whichever `AccountStage` bucket `stage` resolves to. */
export function getStackConfiguration(stage: string): StackConfiguration {
  return configByAccountStage[resolveAccountStage(stage)];
}
