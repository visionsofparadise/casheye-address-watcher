import { Stack, Construct, StackProps, SecretValue, Fn } from '@aws-cdk/core';
import { Artifact } from '@aws-cdk/aws-codepipeline';
import { CdkPipeline, SimpleSynthAction, ShellScriptAction } from '@aws-cdk/pipelines';
import { GitHubSourceAction } from '@aws-cdk/aws-codepipeline-actions';
import { CasheyeAddressWatcherStage } from './stack';
import { App } from '@aws-cdk/core';

export const serviceName = 'casheye-address-watcher';

export class CasheyeAddressWatcherPipelineStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		const sourceArtifact = new Artifact();
		const cloudAssemblyArtifact = new Artifact();

		const sourceAction = new GitHubSourceAction({
			actionName: 'source',
			owner: 'visionsofparadise',
			repo: serviceName,
			oauthToken: SecretValue.secretsManager('GITHUB_TOKEN'),
			output: sourceArtifact,
			branch: 'master'
		});

		const synthAction = new SimpleSynthAction({
			sourceArtifact,
			cloudAssemblyArtifact,
			installCommands: ['npm i'],
			buildCommands: [
				`CDK_DEFAULT_ACCOUNT=${SecretValue.secretsManager('ACCOUNT_NUMBER')}`,
				'npm run compile',
			],
			testCommands: ['npm run test'],
			synthCommand: 'npm run synth'
		});

		const pipeline = new CdkPipeline(this, 'pipeline', {
			pipelineName: serviceName + '-pipeline',
			cloudAssemblyArtifact,
			sourceAction,
			synthAction
		});

		const testApp = new CasheyeAddressWatcherStage(this, serviceName + '-test', {
			STAGE: 'test'
		});

		const testAppStage = pipeline.addApplicationStage(testApp);

		testAppStage.addActions(
			new ShellScriptAction({
				actionName: 'IntegrationTests',
				runOrder: testAppStage.nextSequentialRunOrder(),
				additionalArtifacts: [sourceArtifact],
				commands: [
					'sleep 180s',
					`export CDK_DEFAULT_ACCOUNT=${SecretValue.secretsManager('ACCOUNT_NUMBER')}`,
					`export UTILITY_API_URL=${Fn.importValue('casheye-utility-test-apiUrl')}`,
					`export TEST_XPUBKEY=${SecretValue.secretsManager('TEST_XPUBKEY')}`,
					'npm i',
					'npm run integration --passWithNoTests'
				],
				useOutputs: {
					INSTANCE_URL: pipeline.stackOutput(testApp.instanceUrl),
					SECRET: pipeline.stackOutput(testApp.secret)
				}
			})
		);

		pipeline.addStage('Approval').addManualApprovalAction({
			actionName: 'Approval'
		})

		const prodApp = new CasheyeAddressWatcherStage(this, serviceName + '-prod', {
			STAGE: 'prod'
		});

		pipeline.addApplicationStage(prodApp);
	}
}

const app = new App();

new CasheyeAddressWatcherPipelineStack(app, `${serviceName}-pipeline-stack`, {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: 'us-east-1'
	}
});

app.synth();