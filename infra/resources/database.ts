/**
 * DynamoDB table resource.
 *
 * Single-table design (see DECISIONS.md "Data model: single-table design"): PK = item
 * id, SK distinguishes the record kind sharing that partition (`latest`, `VERSION#`,
 * `AUDIT#` — see `src/storage/single-table-keys.ts`). Physical table name is left to
 * CDK's default (stack-name-derived, unique per stack/stage) — no extra naming code
 * needed, matching the SST version's approach on the sibling branch.
 *
 * `GSI1`/`GSI2` back `listItems`'s subject/status filters with a `Query` instead of a
 * `Scan` (see `src/storage/dynamodb.ts` and `single-table-keys.ts`). `GSI1PK`/`GSI1SK`
 * and `GSI2PK`/`GSI2SK` are only ever written on the `latest` record, so both indexes
 * are sparse — they only ever contain one entry per item, never `VERSION#`/`AUDIT#`
 * rows, with no extra filtering needed on either index.
 */
import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';

import type { Construct } from 'constructs';

export interface CreateExamItemsTableOptions {
  removalPolicy: RemovalPolicy;
}

export function createExamItemsTable(scope: Construct, { removalPolicy }: CreateExamItemsTableOptions): Table {
  const table = new Table(scope, 'ExamItemsTable', {
    partitionKey: { name: 'PK', type: AttributeType.STRING },
    sortKey: { name: 'SK', type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    removalPolicy,
  });

  table.addGlobalSecondaryIndex({
    indexName: 'GSI1',
    partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
    sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
  });

  table.addGlobalSecondaryIndex({
    indexName: 'GSI2',
    partitionKey: { name: 'GSI2PK', type: AttributeType.STRING },
    sortKey: { name: 'GSI2SK', type: AttributeType.STRING },
  });

  return table;
}
