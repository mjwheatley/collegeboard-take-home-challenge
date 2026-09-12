import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/** The event shape after `@middy/http-json-body-parser` has replaced `body` with the parsed JSON value. */
export type APIGatewayProxyEventV2JsonParsedBody = Omit<APIGatewayProxyEventV2, 'body'> & {
  body: unknown;
};

export type WithPathParameters<Event, Keys extends string> = Event & {
  pathParameters: Record<Keys, string>;
};
