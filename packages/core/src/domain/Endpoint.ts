export interface Endpoint {
  method: string;
  path: string;
}

export function normalise(endpoint: Endpoint): string {
  const normalisedPath = endpoint.path.replace(/\{([^}]+)\}/g, ":$1");
  return `${endpoint.method.toUpperCase()} ${normalisedPath}`;
}
