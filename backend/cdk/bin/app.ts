#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SchemaConverterStack } from "../lib/schema-converter-stack";

const app = new cdk.App();
new SchemaConverterStack(app, "DSQLSchemaConverterStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-west-2",
  },
});
