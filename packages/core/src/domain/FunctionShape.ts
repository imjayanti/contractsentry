export interface FunctionShape {
  name: string;
  endpointGuess: string | null;
  returnShape: Record<string, string | null> | null;
  paramShape: Record<string, string | null> | null;
  line: number;
  suppressed: boolean;
  isDynamic: boolean;
}
