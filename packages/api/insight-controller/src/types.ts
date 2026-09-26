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
