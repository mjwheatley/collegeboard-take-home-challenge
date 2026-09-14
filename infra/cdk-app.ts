/**
 * CDK app entry point (`cdk.json`'s `app` command runs this via `tsx`, so it can
 * import `.ts` sources directly with no separate build step — CDK's own
 * `--app "npx ts-node ..."` pattern, swapped for `tsx` for consistency with
 * `src/server.ts`). `stage` is read from the `--context stage=<name>` CLI flag
 * (defaulting to a personal `dev` stage), CDK's equivalent of SST's `--stage`.
 */
import { App } from 'aws-cdk-lib';

import { ItemChallengeStack } from './item-challenge-stack.js';

const app = new App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';

new ItemChallengeStack(app, `ItemChallenge-${stage}`, { stage });
