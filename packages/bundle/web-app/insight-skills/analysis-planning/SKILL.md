---
name: analysis-planning
description: Turn a data question into an explicit metric, grain, filters, joins, and validation plan.
---

# Analysis planning

Before SQL, write a compact plan containing:

- the requested metric and output grain;
- filters, time interval, timezone, and inclusivity of boundaries;
- join keys and expected join cardinality;
- treatment of NULL, duplicates, and zero denominators;
- one primary query and at least one validation check.

Resolve facts from discovered schema and profiles. Put unresolved business
meaning in `assumptions`; if two interpretations materially change the answer,
ask the user instead of silently choosing one.
