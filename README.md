# Aurora DSQL Schema Converter

> **Live tool:** https://aws-samples.github.io/sample-dsql-schema-convertor/

A web tool that converts database schemas from PostgreSQL, MySQL, Oracle, or SQL Server to Aurora DSQL-compatible format. Powered by AI (Amazon Bedrock) for intelligent conversion and `dsql-lint` for validation.

## How to use

1. Open the [Schema Converter](https://aws-samples.github.io/sample-dsql-schema-convertor/)
2. Select your source database engine
3. Paste your DDL or upload `.sql` files
4. Click **Convert Schema**
5. Review the output and conversion summary
6. Click **"Try in DSQL Playground"** to test your converted schema
7. Download the migration README for your records

## Features

- **Multi-engine support** — Convert from PostgreSQL, MySQL, Oracle, or SQL Server
- **AI-powered conversion** — Uses Amazon Bedrock to intelligently transform schemas for DSQL compatibility
- **Validation** — Validate output with `dsql-lint` to catch any remaining issues
- **DSQL Playground integration** — One-click to test your schema in the [DSQL Playground](https://playground.dsql.demo.aws/)
- **Migration README** — Download a `DSQL_MIGRATION.md` documenting all changes made
- **File upload** — Upload multiple `.sql`, `.ddl`, or `.txt` files at once

## Deployment

### Frontend

Push to `main` — GitHub Actions builds and deploys to GitHub Pages automatically.

### Backend (optional)

The backend provides AI-powered conversion via Amazon Bedrock and `dsql-lint` validation.

```bash
cd backend/cdk
npm install
npx cdk bootstrap   # first time only
npx cdk deploy
```

Set the API Gateway URL output as `VITE_API_URL` in `.env.production` and push to redeploy the frontend.

#### Configuration

The Bedrock model is configurable via Lambda environment variables:

| Variable | Default | Description |
|---|---|---|
| `BEDROCK_MODEL_ID` | `anthropic.claude-sonnet-4-20250514-v1:0` | The Bedrock model used for conversion |
| `BEDROCK_REGION` | `us-west-2` | AWS region for Bedrock API calls |

Update these in the Lambda console or CDK stack when newer models are available — no code change required.

## Local Development

```bash
npm install
npm run dev
```

## Tech Stack

- **Frontend:** React + [AWS Cloudscape Design System](https://cloudscape.design/)
- **Backend:** Python 3.12 Lambda (Docker) with [Strands Agents](https://github.com/strands-agents/strands-agents-python) + Amazon Bedrock
- **Validation:** [dsql-lint](https://github.com/awslabs/dsql-lint)
- **Infrastructure:** AWS CDK (API Gateway + Lambda)
- **Hosting:** GitHub Pages (deployed via GitHub Actions)

## Resources

- [Aurora DSQL Documentation](https://docs.aws.amazon.com/aurora-dsql/)
- [DSQL Migration Guide](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html)
- [DSQL Playground](https://playground.dsql.demo.aws/)
- [Aurora DSQL MCP Server](https://awslabs.github.io/mcp/servers/aurora-dsql-mcp-server)

## License

This project is licensed under the MIT-0 License.
