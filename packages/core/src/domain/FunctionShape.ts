export interface FieldShapeRecord {
  [key: string]: FieldShape;
}

export type FieldShape = string | null | FieldShapeRecord;

export interface FunctionShape {
  name: string;
  endpointGuess: string | null;
  statusHint: number | null;
  returnShape: FieldShapeRecord | null;
  paramShape: Record<string, string | null> | null;
  line: number;
  suppressed: boolean;
  isDynamic: boolean;
}
