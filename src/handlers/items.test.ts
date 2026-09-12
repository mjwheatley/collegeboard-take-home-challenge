import { describe, expect, it } from "vitest";

import { createItemHandler, getItemHandler } from "./items.js";

import type { APIGatewayProxyEventV2JsonParsedBody } from "../types/api-gateway.js";
import type { CreateItemRequest } from "../types/item.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from "aws-lambda";

const noopContext = {} as Context;

/**
 * Builds a raw (pre-`middyJsonBodyParser`) event, same shape a real API Gateway
 * invocation or SST's local dev would send. The cast to `APIGatewayProxyEventV2JsonParsedBody`
 * is because the exported handlers' declared parameter type reflects the shape
 * `middyJsonBodyParser`'s `before` hook produces *inside* the invocation, not what a
 * caller actually provides at the boundary -- the same type/runtime split the
 * reference this is ported from has (its own handlers are typed against
 * `APIGatewayProxyEventJsonParsedBody`, never the raw wire event either).
 *
 * Only sets `content-type: application/json` when a body is actually provided --
 * matching a real GET/DELETE request, which wouldn't send that header. Setting it
 * unconditionally would make `middyJsonBodyParser` try to parse a body that doesn't
 * exist and 422 (it only skips parsing when disableContentTypeError's fallback --
 * "no matching content-type" -- kicks in, not when a body is simply absent).
 */
function fakeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2JsonParsedBody {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: { accept: "application/json", ...(overrides.body && { "content-type": "application/json" }) },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      http: { method: "GET", path: "/", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" },
      requestId: "test-request-id",
      routeKey: "$default",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2JsonParsedBody;
}

function jsonBody(result: APIGatewayProxyStructuredResultV2): unknown {
  return typeof result.body === "string" ? JSON.parse(result.body) : result.body;
}

const createItemPayload = {
  subject: "AP Biology",
  itemType: "multiple-choice",
  difficulty: 3,
  content: {
    question: "What is photosynthesis?",
    options: ["A", "B", "C", "D"],
    correctAnswer: "A",
    explanation: "Photosynthesis is the process...",
  },
  metadata: {
    author: "test-author",
    status: "draft",
    tags: ["biology", "photosynthesis"],
  },
  securityLevel: "standard",
} satisfies CreateItemRequest;

describe("createItemHandler", () => {
  it("should create an item successfully", async () => {
    const event = fakeEvent({ body: JSON.stringify(createItemPayload) });
    const result = await createItemHandler(event, noopContext);
    const body = jsonBody(result) as Record<string, unknown>;

    expect(result.statusCode).toBe(201);
    expect(body).toHaveProperty("id");
    expect(body.subject).toBe("AP Biology");
    expect(body.metadata).toHaveProperty("author", "test-author");
  });
});

describe("getItemHandler", () => {
  it("should return 404 for non-existent item", async () => {
    const event = fakeEvent({ pathParameters: { id: "non-existent-id" } });
    const result = await getItemHandler(event, noopContext);
    const body = jsonBody(result) as Record<string, unknown>;

    expect(result.statusCode).toBe(404);
    expect(body.message).toBe("Item not found");
  });

  it("should retrieve an existing item", async () => {
    const createEvent = fakeEvent({
      body: JSON.stringify({
        subject: "AP Calculus",
        itemType: "free-response",
        difficulty: 4,
        content: {
          question: "Calculate the derivative...",
          correctAnswer: "42",
          explanation: "Using the chain rule...",
        },
        metadata: { author: "test-author", status: "approved", tags: ["calculus", "derivatives"] },
        securityLevel: "standard",
      } satisfies CreateItemRequest),
    });

    const createResult = await createItemHandler(createEvent, noopContext);
    const createdBody = jsonBody(createResult) as { id: string; subject: string };

    expect(createdBody).toHaveProperty("id");

    const getEvent = fakeEvent({ pathParameters: { id: createdBody.id } });
    const getResult = await getItemHandler(getEvent, noopContext);
    const getBody = jsonBody(getResult) as { id: string; subject: string };

    expect(getResult.statusCode).toBe(200);
    expect(getBody.id).toBe(createdBody.id);
    expect(getBody.subject).toBe("AP Calculus");
  });
});
