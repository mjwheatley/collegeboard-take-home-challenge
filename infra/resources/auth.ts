/**
 * Cognito User Pool + Client backing the API Gateway JWT authorizer.
 *
 * `usernames: ['email']` makes email a sign-in alias (and therefore the target for
 * "forgot password" resets) without making it the immutable username itself. Self-service
 * sign-up is disabled via `adminCreateUserConfig.allowAdminCreateUserOnly` -- accounts are
 * created manually in the AWS console, there is no public registration flow.
 *
 * No Identity Pool: that component vends temporary AWS credentials for direct
 * client-side AWS SDK calls (e.g. S3 uploads), which this API doesn't need. The JWT
 * authorizer on the API Gateway routes only needs the User Pool's issuer URL and a
 * Client ID as the audience -- see `infra/resources/api-gateway.ts`.
 */
export function createUserPool() {
  const userPool = new sst.aws.CognitoUserPool('UserPool', {
    usernames: ['email'],
    transform: {
      userPool: (args) => {
        args.adminCreateUserConfig = {
          allowAdminCreateUserOnly: true,
        };
      },
    },
  });

  const client = userPool.addClient('WebClient');

  return { userPool, client };
}
