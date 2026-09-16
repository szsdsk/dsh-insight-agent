from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def test_stdio_register_discover_query_verify(workspace: Path) -> None:
    asyncio.run(_exercise_server(workspace))


async def _exercise_server(workspace: Path) -> None:
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "insight_mcp"],
        env={
            **os.environ,
            "INSIGHT_WORKSPACE": str(workspace),
            "INSIGHT_QUERY_TIMEOUT_SECONDS": "10",
            "PYTHONUNBUFFERED": "1",
        },
    )
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            assert names == {
                "register_source",
                "list_relations",
                "describe_relation",
                "profile_relation",
                "sample_rows",
                "execute_sql",
                "verify_query",
            }

            registered = await session.call_tool(
                "register_source", {"path": "sales.csv", "kind": "csv"}
            )
            assert not registered.isError
            source_id = registered.structuredContent["source_id"]

            relations = await session.call_tool(
                "list_relations", {"source_id": source_id}
            )
            assert relations.structuredContent["relations"] == ["data"]

            described = await session.call_tool(
                "describe_relation", {"source_id": source_id, "relation": "data"}
            )
            assert described.structuredContent["columns"][0]["name"] == "region"

            queried = await session.call_tool(
                "execute_sql",
                {
                    "source_id": source_id,
                    "sql": "SELECT region, SUM(amount) AS total FROM data GROUP BY region",
                },
            )
            assert not queried.isError
            query_id = queried.structuredContent["query_id"]

            verified = await session.call_tool(
                "verify_query", {"query_id": query_id}
            )
            assert verified.structuredContent["valid"] is True
