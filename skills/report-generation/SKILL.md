---
name: report-generation
description: Deliver concise findings with query-level evidence, assumptions, and limitations.
---

# Report generation

Finish every data answer through `submit_analysis`.

- `answer` states the conclusion and the units/time scope.
- Each `evidence` item contains one concrete claim and the exact successful
  `query_id` proving it.
- `assumptions` lists choices not established by the data.
- `limitations` lists truncation, missing data, ambiguity, coverage, or checks
  that could not be completed.

Do not paste sensitive rows into prose. Prefer aggregates. If no successful
query supports the requested conclusion, say so and do not submit a factual
answer as though it were verified.
