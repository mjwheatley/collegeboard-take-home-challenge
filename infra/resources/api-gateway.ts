/**
 * API Gateway (HTTP API / v2) resource and routes.
 *
 * See DECISIONS.md "Infrastructure: SST v3 / Pulumi" for why `HttpApi` (HTTP API)
 * rather than a REST `RestApi` (v1) — the same v1 triggers (API keys, WAF) noted
 * there would change this on the CDK side too. Each route gets its own
 * `NodejsFunction` (esbuild-bundled, no Docker needed — matches the per-route Lambda
 * shape SST's `api.route()` produces) rather than one Lambda fronting all routes,
 * so IAM/env wiring stays scoped per-handler exactly as it did under SST.
 */
import { Duration } from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export interface CreateApiOptions {
  table: Table;
  accountStage: string;
  stackConfig: { LOG_LEVEL: string };
}

interface RouteDefinition {
  id: string;
  method: HttpMethod;
  path: string;
  handlerExport: string;
}

const ROUTES: RouteDefinition[] = [
  { id: 'ListItems', method: HttpMethod.GET, path: '/api/items', handlerExport: 'listItemsHandler' },
  { id: 'CreateItem', method: HttpMethod.POST, path: '/api/items', handlerExport: 'createItemHandler' },
  { id: 'GetItem', method: HttpMethod.GET, path: '/api/items/{id}', handlerExport: 'getItemHandler' },
  { id: 'UpdateItem', method: HttpMethod.PUT, path: '/api/items/{id}', handlerExport: 'updateItemHandler' },
  {
    id: 'CreateVersion',
    method: HttpMethod.POST,
    path: '/api/items/{id}/versions',
    handlerExport: 'createVersionHandler',
  },
  {
    id: 'ListVersions',
    method: HttpMethod.GET,
    path: '/api/items/{id}/versions',
    handlerExport: 'listVersionsHandler',
  },
  {
    id: 'GetAuditTrail',
    method: HttpMethod.GET,
    path: '/api/items/{id}/audit',
    handlerExport: 'getAuditTrailHandler',
  },
];

export function createApi(scope: Construct, { table, accountStage, stackConfig }: CreateApiOptions): HttpApi {
  const environment = {
    USE_DYNAMODB: 'true',
    DYNAMODB_TABLE_NAME: table.tableName,
    LOG_LEVEL: stackConfig.LOG_LEVEL,
    ACCOUNT_STAGE: accountStage,
  };

  const api = new HttpApi(scope, 'Api');

  for (const route of ROUTES) {
    const fn = new NodejsFunction(scope, `${route.id}Function`, {
      entry: 'src/handlers/items.ts',
      handler: route.handlerExport,
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment,
    });

    table.grantReadWriteData(fn);

    api.addRoutes({
      path: route.path,
      methods: [route.method],
      integration: new HttpLambdaIntegration(`${route.id}Integration`, fn),
    });
  }

  return api;
}
