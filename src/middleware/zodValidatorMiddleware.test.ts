import middy from "@middy/core";
import { describe, expect, it } from "vitest";
import { number, object, string } from "zod";

import { zodValidatorMiddleware } from "./zodValidatorMiddleware.js";

const requestSchema = object({ id: string() });
const responseSchema = object({ statusCode: number(), body: object({ id: string() }) });

describe("zodValidatorMiddleware", () => {
  it("passes a valid request through and returns a valid response", async () => {
    const handler = middy<{ id: string }, { statusCode: number; body: { id: string } }>(
      (event: { id: string }) => ({ statusCode: 200, body: { id: event.id } }),
    ).use(zodValidatorMiddleware({ requestSchema, responseSchema }));

    const result = await handler({ id: "item-1" }, {} as never);

    expect(result).toEqual({ statusCode: 200, body: { id: "item-1" } });
  });

  it("rejects a request that fails the request schema", async () => {
    const handler = middy<{ id: string }, { statusCode: number; body: { id: string } }>(
      (event: { id: string }) => ({ statusCode: 200, body: { id: event.id } }),
    ).use(zodValidatorMiddleware({ requestSchema, responseSchema }));

    await expect(handler({ id: 42 } as never, {} as never)).rejects.toThrow();
  });

  it("rejects a response that fails the response schema", async () => {
    const handler = middy<{ id: string }, unknown>(() => ({ statusCode: 200, body: { wrong: "shape" } })).use(
      zodValidatorMiddleware({ requestSchema, responseSchema }),
    );

    await expect(handler({ id: "item-1" }, {} as never)).rejects.toThrow();
  });

  it("is a no-op when no schemas are provided", async () => {
    const handler = middy<{ id: string }, { id: string }>((event: { id: string }) => event).use(
      zodValidatorMiddleware({}),
    );

    const result = await handler({ id: "item-1" }, {} as never);

    expect(result).toEqual({ id: "item-1" });
  });
});
