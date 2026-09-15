/**
 * API Gateway (HTTP API / v2) resource and routes.
 *
 * See DECISIONS.md "Infrastructure: SST v3 / Pulumi" for why `ApiGatewayV2` (HTTP API)
 * rather than `ApiGatewayV1` (REST API), and "`sst.config.ts`: the actual IaC" for why
 * shared function defaults are spread into every route individually rather than set
 * once — `ApiGatewayV2Args` only has an all-routes knob for `link`, not `environment`.
 */

export interface CreateApiOptions {
  table: sst.aws.Dynamo;
  accountStage: string;
  stackConfig: { LOG_LEVEL: string };
  userPool: sst.aws.CognitoUserPool;
  userPoolClient: sst.aws.CognitoUserPoolClient;
}

interface FunctionDefaults {
  link: sst.aws.Dynamo[];
  environment: Record<string, string>;
}

interface JwtAuthorizer {
  jwt: {
    issuer: Output<string>;
    audiences: Output<string>[];
  };
}

// Bag for any non-auth-related, all-routes function config that shows up later
// (e.g. timeouts, memory) alongside `auth` -- kept separate from `functionDefaults`
// since that one is DynamoDB-specific.
type FunctionConfig = JwtAuthorizer;

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

  // Every route requires a valid Cognito-issued JWT (see `infra/resources/auth.ts`);
  // API Gateway validates the token itself before invoking the handler.
  const auth: JwtAuthorizer = {
    jwt: {
      issuer: $interpolate`https://cognito-idp.${aws.getRegionOutput().name}.amazonaws.com/${userPool.id}`,
      audiences: [userPoolClient.id],
    },
  };
  const functionConfig: FunctionConfig = {
    ...auth,
  };

  const api = new sst.aws.ApiGatewayV2('Api');

  api.route('GET /api/items', {
    handler: 'src/handlers/items.listItemsHandler',
    ...functionDefaults,
    ...functionConfig,
  });
  api.route('POST /api/items', {
    handler: 'src/handlers/items.createItemHandler',
    ...functionDefaults,
    ...functionConfig,
  });
  api.route('GET /api/items/{id}', {
    handler: 'src/handlers/items.getItemHandler',
    ...functionDefaults,
    ...functionConfig,
  });
  api.route('PUT /api/items/{id}', {
    handler: 'src/handlers/items.updateItemHandler',
    ...functionDefaults,
    ...functionConfig,
  });
  api.route('POST /api/items/{id}/versions', {
    handler: 'src/handlers/items.createVersionHandler',
    ...functionDefaults,
    ...functionConfig,
  });
  api.route('GET /api/items/{id}/versions', {
    handler: 'src/handlers/items.listVersionsHandler',
    ...functionDefaults,
    ...functionConfig,
  });
  api.route('GET /api/items/{id}/audit', {
    handler: 'src/handlers/items.getAuditTrailHandler',
    ...functionDefaults,
    ...functionConfig,
  });

  return api;
}
