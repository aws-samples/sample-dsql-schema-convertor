import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

export class SchemaConverterStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const converterFunction = new lambda.DockerImageFunction(
      this,
      "DSQLConverterFunction",
      {
        functionName: "dsql-schema-converter",
        code: lambda.DockerImageCode.fromImageAsset(
          path.join(__dirname, "../../")
        ),
        timeout: Duration.seconds(60),
        memorySize: 512,
        architecture: lambda.Architecture.ARM_64,
        environment: {
          AWS_LWA_INVOKE_MODE: "RESPONSE_STREAM",
        },
      }
    );

    converterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: ["*"],
      })
    );

    const api = new apigateway.RestApi(this, "DSQLConverterApi", {
      restApiName: "DSQL Schema Converter API",
      description: "API for Aurora DSQL schema conversion powered by Strands Agent",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      },
    });

    const convertResource = api.root.addResource("convert");
    convertResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(converterFunction, {
        proxy: true,
      })
    );

    const lintResource = api.root.addResource("lint");
    lintResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(converterFunction, {
        proxy: true,
      })
    );
  }
}
