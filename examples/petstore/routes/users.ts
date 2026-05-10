// Example routes with intentional contract drift — used as analyzer test fixtures.

// @route GET /users/{id}
// DRIFT: missing `email` field — spec requires id + name + email
export function getUser(id: number) {
  return { id, name: "Alice" };
}

// @route GET /users
export function listUsers() {
  return [{ id: 1, name: "Alice", email: "alice@example.com" }];
}

// @route POST /users
// DRIFT: id is string (should be integer), email is missing
export function createUser(name: string, email: string) {
  return { id: "1", name };
}

// csentry-ignore
export function deleteUser(id: number) {
  return { deleted: id };
}
