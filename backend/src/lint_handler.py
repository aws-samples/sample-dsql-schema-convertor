"""
Aurora DSQL Schema Lint Handler.
Invokes dsql-lint binary to validate and auto-fix SQL for DSQL compatibility.
"""

import json
import subprocess
import tempfile
import os
from typing import Any, Dict


def handle_lint(event: Dict[str, Any]) -> Dict[str, Any]:
    """Validate SQL using dsql-lint and return diagnostics + fixed SQL."""

    if "body" in event:
        body = json.loads(event["body"]) if isinstance(event["body"], str) else event["body"]
    else:
        body = event

    sql = body.get("sql", "")

    if not sql.strip():
        return {
            "statusCode": 400,
            "headers": cors_headers(),
            "body": json.dumps({"error": "No SQL provided"}),
        }

    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False) as f:
        f.write(sql)
        tmp_path = f.name

    try:
        result = subprocess.run(
            ["dsql-lint", tmp_path, "--format", "json", "--fix"],
            capture_output=True,
            text=True,
            timeout=30,
        )

        output = result.stdout.strip()

        try:
            lint_result = json.loads(output)
        except json.JSONDecodeError:
            lint_result = {"diagnostics": [], "raw_output": output}

        diagnostics = lint_result.get("diagnostics", [])
        fixed_sql = lint_result.get("fixed_sql", "")

        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps({
                "valid": len(diagnostics) == 0,
                "diagnostics": diagnostics,
                "fixed_sql": fixed_sql if fixed_sql else None,
                "summary": {
                    "errors": sum(1 for d in diagnostics if d.get("severity") == "error"),
                    "warnings": sum(1 for d in diagnostics if d.get("severity") == "warning"),
                },
            }),
        }

    except subprocess.TimeoutExpired:
        return {
            "statusCode": 504,
            "headers": cors_headers(),
            "body": json.dumps({"error": "Lint operation timed out"}),
        }
    except FileNotFoundError:
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": "dsql-lint binary not found"}),
        }
    finally:
        os.unlink(tmp_path)


def cors_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    }
