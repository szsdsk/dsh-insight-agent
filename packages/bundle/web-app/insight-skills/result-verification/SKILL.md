---
name: result-verification
description: Validate executed query results and probe common analytical failure modes.
---

# Result verification

For every query used as evidence, call `mcp__insight__verify_query`.

Treat these as required checks:

- the query is read-only and single-statement;
- row shape matches the returned columns;
- truncation does not invalidate the conclusion;
- empty results are reported as empty, not interpreted as zero;
- aggregates are cross-checked with a count, component sum, or alternative
  grouping when feasible;
- joins do not unexpectedly multiply rows and NULL treatment matches the plan.

Only a successful `execute_sql` `query_id` from this session can support a
claim. A validation warning must be addressed or listed as a limitation.
