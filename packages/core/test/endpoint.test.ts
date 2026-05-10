import { describe, expect, it } from "vitest";
import { normalise } from "../src/domain/Endpoint.js";

describe("normalise", () => {
  it("uppercases the method", () => {
    expect(normalise({ method: "get", path: "/users" })).toBe("GET /users");
  });

  it("leaves an already-uppercase method unchanged", () => {
    expect(normalise({ method: "POST", path: "/users" })).toBe("POST /users");
  });

  it("replaces {param} with :param", () => {
    expect(normalise({ method: "GET", path: "/users/{id}" })).toBe(
      "GET /users/:id",
    );
  });

  it("replaces multiple path parameters", () => {
    expect(
      normalise({ method: "GET", path: "/orgs/{orgId}/repos/{repoId}" }),
    ).toBe("GET /orgs/:orgId/repos/:repoId");
  });

  it("leaves paths with no parameters unchanged", () => {
    expect(normalise({ method: "DELETE", path: "/sessions" })).toBe(
      "DELETE /sessions",
    );
  });

  it("handles root path", () => {
    expect(normalise({ method: "GET", path: "/" })).toBe("GET /");
  });
});
