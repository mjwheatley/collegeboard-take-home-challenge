/**
 * API Gateway (HTTP API / v2) resource and routes.
 *
 * See DECISIONS.md "Infrastructure: SST v3 / Pulumi" for why `ApiGatewayV2` (HTTP API)
 * rather than `ApiGatewayV1` (REST API), and "`sst.config.ts`: the actual IaC" for why
 * shared function defaults are spread into every route individually rather than set
 * once — `ApiGatewayV2Args` only has an all-routes knob for `link`, not `environment`.
 */

import { ApiGatewayV2Authorizer } from "../../.sst/platform/src/components/aws/apigatewayv2-authorizer";
import { FunctionArgs } from "../../.sst/platform/src/components/aws/function";

export interface CreateApiOptions {
  table: sst.aws.Dynamo;
  accountStage: string;
  stackConfig: { LOG_LEVEL: string };
  userPool: sst.aws.CognitoUserPool;
  userPoolClient: ReturnType<sst.aws.CognitoUserPool['addClient']>;
}

interface FunctionDefaults {
  link: sst.aws.Dynamo[];
  environment: FunctionArgs['environment'];
}


export function createApi({ table, accountStage, stackConfig, userPool, userPoolClient }: CreateApiOptions) {
  // `link: [table]` grants each function's IAM role DynamoDB access automatically
  // (Dynamo implements Link.Linkable); the explicit env vars are still needed since
  // the storage layer reads process.env directly rather than importing `sst`'s
  // `Resource` object, to stay framework-agnostic and unit-testable without SST.
  const functionDefaults: FunctionDefaults = {
    link: [table],
    environment: {
      USE_DYNAMODB: 'true',
      DYNAMODB_TABLE_NAME: table.name,
      LOG_LEVEL: stackConfig.LOG_LEVEL,
      ACCOUNT_STAGE: accountStage,
    },
  };

  // We define the authorizer as a variable that will be assigned after the api is created.
  // The transform callback will be executed during api.route() calls,
  // by which time the authorizer will have been created.
  let authorizer: ApiGatewayV2Authorizer | undefined;

  // Use a dummy assignment to satisfy the lint rule 'prefer-const'
  // as the authorizer is assigned shortly after the API is initialized.
  authorizer = undefined;

  const api = new sst.aws.ApiGatewayV2('Api', {
    transform: {
      route: {
        args: (props) => {
          props.auth = {
            jwt: {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              authorizer: authorizer!.id,
            },
          };
        },
      },
    },
  });

  authorizer = api.addAuthorizer({
    name: 'CognitoAuthorizer',
    jwt: {
      issuer: $interpolate`https://cognito-idp.${aws.getRegionOutput().region}.amazonaws.com/${userPool.id}`,
      audiences: [userPoolClient.id],
    },
  });

  api.route('GET /api/items', {
    handler: 'src/handlers/items.listItemsHandler',
    ...functionDefaults,
  });
  api.route('POST /api/items', {
    handler: 'src/handlers/items.createItemHandler',
    ...functionDefaults,
  });
  api.route('GET /api/items/{id}', {
    handler: 'src/handlers/items.getItemHandler',
    ...functionDefaults,
  });
  api.route('PUT /api/items/{id}', {
    handler: 'src/handlers/items.updateItemHandler',
    ...functionDefaults,
  });
  api.route('POST /api/items/{id}/versions', {
    handler: 'src/handlers/items.createVersionHandler',
    ...functionDefaults,
  });
  api.route('GET /api/items/{id}/versions', {
    handler: 'src/handlers/items.listVersionsHandler',
    ...functionDefaults,
  });
  api.route('GET /api/items/{id}/audit', {
    handler: 'src/handlers/items.getAuditTrailHandler',
    ...functionDefaults,
  });

  return api;
}
