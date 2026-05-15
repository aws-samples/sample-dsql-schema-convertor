"""
Aurora DSQL Schema Converter — Strands Agent Lambda Handler.
Uses Claude via Amazon Bedrock to convert PostgreSQL schemas to DSQL-compatible format.
"""

import json
from typing import Any, Dict
from strands import Agent
from strands.models import BedrockModel

SYSTEM_PROMPT = """You are an expert database engineer specializing in Aurora DSQL migrations.
Your task is to convert PostgreSQL DDL schemas into Aurora DSQL-compatible schemas.

Aurora DSQL has these constraints — you MUST apply all of them:

1. NO SEQUENCES or SERIAL types — Replace with UUID columns using gen_random_uuid() as the default.
2. NO FOREIGN KEY constraints — Remove all REFERENCES, FOREIGN KEY clauses, and FK constraints entirely. Add a comment noting referential integrity must be enforced at the application layer.
3. NO TRIGGERS — Remove all CREATE TRIGGER statements. Note in comments what the trigger did.
4. NO STORED PROCEDURES or FUNCTIONS — Remove all CREATE FUNCTION/PROCEDURE blocks. Note in comments what they did.
5. NO EXTENSIONS — Remove all CREATE EXTENSION statements.
6. NO TABLE INHERITANCE — Remove INHERITS clauses.
7. NO PARTITIONING — Remove PARTITION BY clauses. DSQL distributes data automatically.
8. NO RULES — Remove CREATE RULE statements.
9. NO LISTEN/NOTIFY — Remove these statements.
10. NO TABLESPACE — Remove TABLESPACE clauses.

Output format:
1. First, output the converted SQL enclosed in ```sql ... ``` code block.
2. Then output a "## Changes Made" section with a bullet list of every modification, categorized as:
   - [REMOVED] — for features that were deleted
   - [MODIFIED] — for features that were transformed
   - [NOTE] — for important migration considerations

Keep all valid PostgreSQL syntax that IS supported by DSQL (CREATE TABLE, indexes, CHECK constraints, UNIQUE constraints, NOT NULL, DEFAULT values, standard data types, etc.).

Preserve formatting and comments from the original where they remain relevant."""


def create_agent() -> Agent:
    model = BedrockModel(
        model_id="anthropic.claude-sonnet-4-20250514-v1:0",
        region_name="us-west-2",
        temperature=0.1,
        max_tokens=8192,
    )

    return Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        callback_handler=None,
    )


def handler(event: Dict[str, Any], _context) -> Dict[str, Any]:
    """Lambda handler that receives PostgreSQL DDL and returns DSQL-compatible DDL."""

    # Handle API Gateway proxy integration
    if "body" in event:
        body = json.loads(event["body"]) if isinstance(event["body"], str) else event["body"]
    else:
        body = event

    input_schema = body.get("schema", "")

    if not input_schema.strip():
        return {
            "statusCode": 400,
            "headers": cors_headers(),
            "body": json.dumps({"error": "No schema provided"}),
        }

    agent = create_agent()
    prompt = f"Convert the following PostgreSQL schema to be Aurora DSQL-compatible:\n\n```sql\n{input_schema}\n```"

    result = agent(prompt)
    response_text = str(result)

    sql_output, changes = parse_response(response_text)

    return {
        "statusCode": 200,
        "headers": cors_headers(),
        "body": json.dumps({
            "converted_schema": sql_output,
            "changes": changes,
            "raw_response": response_text,
        }),
    }


def parse_response(text: str) -> tuple[str, list[dict]]:
    """Extract SQL and change list from the agent's response."""
    sql = ""
    changes = []

    # Extract SQL from code block
    if "```sql" in text:
        parts = text.split("```sql")
        if len(parts) > 1:
            sql_block = parts[1].split("```")[0]
            sql = sql_block.strip()
    elif "```" in text:
        parts = text.split("```")
        if len(parts) > 1:
            sql = parts[1].strip()

    # Extract changes
    if "## Changes Made" in text:
        changes_section = text.split("## Changes Made")[1]
        for line in changes_section.split("\n"):
            line = line.strip()
            if line.startswith("- [REMOVED]") or line.startswith("- **[REMOVED]"):
                changes.append({"type": "removed", "message": clean_change(line, "REMOVED")})
            elif line.startswith("- [MODIFIED]") or line.startswith("- **[MODIFIED]"):
                changes.append({"type": "modified", "message": clean_change(line, "MODIFIED")})
            elif line.startswith("- [NOTE]") or line.startswith("- **[NOTE]"):
                changes.append({"type": "info", "message": clean_change(line, "NOTE")})

    if not sql:
        sql = text

    return sql, changes


def clean_change(line: str, tag: str) -> str:
    """Remove the tag prefix from a change line."""
    line = line.lstrip("- ")
    line = line.replace(f"[{tag}]", "").replace(f"**[{tag}]**", "")
    return line.strip().lstrip("— ").lstrip("- ").strip()


def cors_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    }
