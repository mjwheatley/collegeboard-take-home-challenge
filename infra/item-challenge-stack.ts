/**
 * The single CDK stack for this app — DynamoDB table + API Gateway v2 routes,
 * wired together the same way `sst.config.ts` does on the sibling `mjwheatley/sst`
 * branch. `stage` is CDK's analogue of SST's `$app.stage`: an arbitrary per-deploy
 * name (personal dev stack, PR preview, `staging`, `production`, ...) that
 * `resolveAccountStage`/`getStackConfiguration` bucket into behavioral config —
 * see `infra/stage.ts`.
 */
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';

import { createApi } from './resources/api-gateway.js';
import { createExamItemsTable } from './resources/database.js';
import { getStackConfiguration } from './stack-configuration.js';
import { AccountStage, resolveAccountStage } from './stage.js';

import type { Construct } from 'constructs';

export interface ItemChallengeStackProps extends StackProps {
  stage: string;
}

export class ItemChallengeStack extends Stack {
  constructor(scope: Construct, id: string, props: ItemChallengeStackProps) {
    super(scope, id, props);

    const accountStage = resolveAccountStage(props.stage);
    const stackConfig = getStackConfiguration(props.stage);

    const table = createExamItemsTable(this, {
      removalPolicy: accountStage === AccountStage.Production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const api = createApi(this, { table, accountStage, stackConfig });

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
