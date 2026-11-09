export type RecordValue = string | number | boolean;

/** Explicitly selected local Node module. Code runs with the CLI's permissions. */
export interface DatasetImporterV1 {
  readonly apiVersion: 1;
  parseRecords(input: { bytes: Uint8Array; filename: string }):
    Record<string, RecordValue>[] | Promise<Record<string, RecordValue>[]>;
}
