export interface FunctionShape {
  name: string;
  endpointGuess: string | null;
  statusHint: number | null;
  returnShape: Record<string, string | null> | null;
  paramShape: Record<string, string | null> | null;
  line: number;
  suppressed: boolean;
  isDynamic: boolean;
}
