import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Version of the saved Insight analysis document and MCP contract. */
export const INSIGHT_PROTOCOL_VERSION = 1
/** File formats accepted by the Insight source registry. */
export type SourceKind = 'csv' | 'xlsx' | 'sqlite' | 'duckdb'
/** Supported two-relation join semantics. */
export type JoinKind = 'inner' | 'left'
/** Aggregations supported by the structured analysis engine. */
export type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct'
/** Predicates supported by the structured analysis engine. */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'is_null' | 'not_null'

/** A column addressed by its relation and column name. */
export interface FieldRef {
  readonly relation: string
  readonly column: string
}
/** Explicit relationship from the primary relation to one secondary relation. */
export interface JoinSpec {
  readonly relation: string
  readonly kind: JoinKind
  readonly left: FieldRef
  readonly right: FieldRef
}
/** Grouping field with an optional date granularity and output alias. */
export interface DimensionSpec {
  readonly field: FieldRef
  readonly alias?: string
  readonly date_grain?: 'day' | 'month' | 'year'
}
/** Aggregate output column; count may omit its input field. */
export interface MetricSpec {
  readonly aggregation: Aggregation
  readonly field?: FieldRef
  readonly alias: string
}
/** Predicate on a source field, with no value for null tests. */
export interface FilterSpec {
  readonly field: FieldRef
  readonly operator: FilterOperator
  readonly value?: JsonValue
}
/** Ordering of one projected output column. */
export interface SortSpec {
  readonly column: string
  readonly direction: 'asc' | 'desc'
}
/** Deterministic query configuration sent to Insight MCP. */
export interface AnalysisSpec {
  readonly relation: string
  readonly join?: JoinSpec
  readonly dimensions: readonly DimensionSpec[]
  readonly metrics: readonly MetricSpec[]
  readonly filters: readonly FilterSpec[]
  readonly sort: readonly SortSpec[]
  readonly limit: number
}
/** Registered source identity valid in the current MCP runtime. */
export interface SourceInfo {
  readonly source_id: string
  readonly kind: SourceKind
  readonly path: string
  readonly fingerprint: string
  readonly warnings: readonly string[]
  readonly selection?: TableSelection | null
}

/** Physical rows selected from one uploaded CSV or workbook sheet. */
export interface TableSelection {
  readonly sheet?: string | null
  readonly header_row: number
  readonly data_start_row?: number | null
  readonly data_end_row?: number | null
}
/** Bounded raw rows used to choose a header and data range. */
export interface TablePreview {
  readonly sheets: readonly string[]
  readonly sheet: string | null
  readonly rows: readonly (readonly JsonValue[])[]
}
/** One named field linked across the two periods. */
export interface ComparisonColumn {
  readonly name: string
  readonly baseline: string
  readonly current: string
}
/** One confirmed business measure. */
export interface ComparisonMetric {
  readonly name: string
  readonly aggregation: 'sum' | 'count' | 'count_distinct' | 'avg'
  readonly field?: string | null
}
/** Filter applied to both periods before computing a measure. */
export interface ComparisonFilter {
  readonly field: string
  readonly operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'not_null'
  readonly value?: JsonValue
}
/** Validated two-period calculation request. */
export interface ComparisonSpec {
  readonly baseline: { readonly source_id: string; readonly relation: string }
  readonly current: { readonly source_id: string; readonly relation: string }
  readonly columns: readonly ComparisonColumn[]
  readonly metrics: readonly ComparisonMetric[]
  readonly dimensions: readonly string[]
  readonly filters: readonly ComparisonFilter[]
  readonly top_n: number
}
/** One quality observation with its count and share of selected rows. */
export interface QualityFinding {
  readonly kind: string
  readonly field?: string
  readonly fields?: readonly string[]
  readonly count: number
  readonly rate: number
  readonly classification?: 'observation' | 'review' | 'blocking'
  readonly query_id?: string
}
/** Query-backed quality result for one selected period. */
export interface QualityResult extends AnalysisResult {
  readonly row_total: number
  readonly findings: readonly QualityFinding[]
  readonly source_warnings: readonly string[]
}
/** Change for one metric in a total or dimension group. */
export interface MetricChange {
  readonly baseline: JsonValue
  readonly current: JsonValue
  readonly delta: number | null
  readonly change_rate: number | null
  readonly contribution_rate?: number | null
}
/** Query-backed comparison with total and bounded group changes. */
export interface ComparisonResult extends AnalysisResult {
  readonly totals: readonly (MetricChange & { readonly name: string })[]
  readonly groups: readonly { readonly dimensions: readonly JsonValue[]; readonly metrics: readonly MetricChange[] }[]
  readonly mapping: readonly ComparisonColumn[]
  readonly metrics: readonly ComparisonMetric[]
}
/** Reusable task configuration without runtime source identifiers or query evidence. */
export interface DiagnosticTask {
  readonly formatVersion: 1
  readonly id: string
  readonly name: string
  readonly baselineSelection: TableSelection
  readonly currentSelection: TableSelection
  readonly columns: readonly ComparisonColumn[]
  readonly metrics: readonly ComparisonMetric[]
  readonly dimensions: readonly string[]
  readonly filters: readonly ComparisonFilter[]
  readonly top_n: number
  readonly key?: string
}
/** Historical run bound to the exact two source fingerprints. */
export interface DiagnosticReport {
  readonly formatVersion: 1
  readonly id: string
  readonly taskId: string
  readonly ranAt: string
  readonly baseline: SourceInfo
  readonly current: SourceInfo
  readonly baselineQuality: QualityResult
  readonly currentQuality: QualityResult
  readonly comparison: ComparisonResult
  readonly dimensionBreakdowns?: readonly ComparisonResult[]
}

/** Relations discovered from a registered source. */
export interface RelationList {
  readonly source_id: string
  readonly relations: readonly string[]
  readonly warnings: readonly string[]
}
/** Column metadata returned during relation discovery. */
export interface ColumnInfo {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
}
/** Schema of one relation in a registered source. */
export interface RelationSchema {
  readonly source_id: string
  readonly relation: string
  readonly columns: readonly ColumnInfo[]
  readonly warnings: readonly string[]
}
/** Query rows and evidence returned after MCP verification. */
export interface AnalysisResult {
  readonly query_id: string
  readonly source_id: string
  readonly source_fingerprint: string
  readonly sql: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly JsonValue[])[]
  readonly row_count: number
  readonly truncated: boolean
  readonly elapsed_ms: number
  readonly verified: boolean
  readonly warnings: readonly string[]
}
/** Versioned workbench configuration and optional historical result snapshot. */
export interface InsightProject {
  readonly formatVersion: 1
  readonly source?: SourceInfo
  readonly analysis?: AnalysisSpec
  readonly chart?: {
    readonly type: 'table' | 'bar' | 'line' | 'scatter'
    readonly title: string
    readonly x?: string
    readonly y?: string
  }
  readonly snapshot?: AnalysisResult
}
