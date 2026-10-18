export const BQ = {
  dataset: process.env.BQ_DATASET ?? "orbstack_ci",
  summaryTable: "nfr_benchmarks",
  gateTable: "nfr_gate_results",
};

export interface InsertAllBody {
  kind: "bigquery#tableDataInsertAllRequest";
  skipInvalidRows: false;
  ignoreUnknownValues: false;
  rows: { insertId: string; json: Record<string, unknown> }[];
}

/** insertId makes a retried upload idempotent (BigQuery best-effort de-duplication). */
export function insertAllBody(rows: Record<string, unknown>[], idOf: (row: Record<string, unknown>) => string): InsertAllBody {
  return { kind: "bigquery#tableDataInsertAllRequest", skipInvalidRows: false, ignoreUnknownValues: false, rows: rows.map((json) => ({ insertId: idOf(json), json })) };
}

export function parseNdjson(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

export function insertErrors(response: { insertErrors?: { index: number; errors: { message: string }[] }[] }): string[] {
  return (response.insertErrors ?? []).flatMap((e) => e.errors.map((x) => `row ${e.index}: ${x.message}`));
}

export function insertAllUrl(project: string, dataset: string, table: string): string {
  return `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/${dataset}/tables/${table}/insertAll`;
}
