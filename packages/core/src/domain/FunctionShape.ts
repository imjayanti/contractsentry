export interface FunctionShape {
  name: string;
  endpointGuess: string | null;
  returnShape: Record<string, unknown> | null;
  paramShape: Record<string, unknown> | null;
  line: number;
  suppressed: boolean;
  isDynamic: boolean;
}
