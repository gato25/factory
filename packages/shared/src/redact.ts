/** Implemented in T027 — redaction happens at ingest, never at display. */
export type Redactor = (text: string) => string;
