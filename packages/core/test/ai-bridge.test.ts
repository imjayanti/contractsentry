import { describe, expect, it, vi } from "vitest";
import { AiBridgeAnalyzer } from "../src/infrastructure/analyzer/AiBridgeAnalyzer.js";

const ENDPOINT = "GET /users/{user_id}";

const USER_SCHEMA = {
  type: "object",
  required: ["id", "name", "email"],
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    email: { type: "string" },
  },
};

const SNIPPET =
  'async def get_user(user_id: int):\n    return {"id": user_id, "name": "Alice"}';

function makeRunner(violations: object[]) {
  return vi.fn().mockResolvedValue(JSON.stringify({ violations }));
}

describe("AiBridgeAnalyzer", () => {
  it("returns an empty array when the AI reports no violations", async () => {
    const bridge = new AiBridgeAnalyzer(makeRunner([]));
    const result = await bridge.analyzeEndpoint(ENDPOINT, USER_SCHEMA, SNIPPET);
    expect(result).toEqual([]);
  });

  it("returns parsed violations from the AI", async () => {
    const raw = [
      {
        field: "email",
        expected: "present",
        found: "missing",
        explanation: "email is required",
      },
    ];
    const bridge = new AiBridgeAnalyzer(makeRunner(raw));
    const result = await bridge.analyzeEndpoint(ENDPOINT, USER_SCHEMA, SNIPPET);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ field: "email", expected: "present" });
  });

  it("passes the correct JSON payload to the runner", async () => {
    const runner = makeRunner([]);
    const bridge = new AiBridgeAnalyzer(runner);
    await bridge.analyzeEndpoint(ENDPOINT, USER_SCHEMA, SNIPPET);

    const sent = JSON.parse(runner.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(sent.protocol_version).toBe(1);
    expect(sent.endpoint).toBe(ENDPOINT);
    expect(sent.schema).toEqual(USER_SCHEMA);
    expect(sent.code_snippet).toBe(SNIPPET);
  });

  it("throws SubprocessError when runner rejects", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("exit 2"));
    const bridge = new AiBridgeAnalyzer(runner);
    await expect(
      bridge.analyzeEndpoint(ENDPOINT, USER_SCHEMA, SNIPPET),
    ).rejects.toThrow("exit 2");
  });

  it("handles multiple violations", async () => {
    const raw = [
      {
        field: "email",
        expected: "present",
        found: "missing",
        explanation: "x",
      },
      { field: "id", expected: "integer", found: "string", explanation: "y" },
    ];
    const bridge = new AiBridgeAnalyzer(makeRunner(raw));
    const result = await bridge.analyzeEndpoint(ENDPOINT, USER_SCHEMA, SNIPPET);
    expect(result).toHaveLength(2);
  });
});
