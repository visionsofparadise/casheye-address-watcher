import { CfnOutput, Construct, Duration, Fn, Stack, StackProps,  Stage, StageProps } from '@aws-cdk/core';
import { serviceName } from './pipeline';
import { BlockDeviceVolume, Instance, InstanceClass, InstanceSize, InstanceType, MachineImage, Port, UserData, Vpc } from '@aws-cdk/aws-ec2';
import { masterOutput } from 'xkore-lambda-helpers/dist/cdk/createOutput'
import { EventResource } from 'xkore-lambda-helpers/dist/cdk/EventResource'
import { masterLambda } from 'xkore-lambda-helpers/dist/cdk/masterLambda'
import { EventBus } from '@aws-cdk/aws-events';
import { Runtime, Code } from '@aws-cdk/aws-lambda';
import { Queue } from '@aws-cdk/aws-sqs';
import { btcAddressUsedEvent } from '../confirm';
import { btcAddressExpiredEvent } from '../watchAddress';
import { btcAddressWatchingEvent } from '../watchAddress';
import { btcTxDetectedEvent } from '../txDetected';
import { btcConfirmationEvent } from '../confirm';
import { onAddressCreatedHandler } from '../handlers/onAddressCreated';
import { DocumentationItems } from 'xkore-lambda-helpers/dist/cdk/DocumentationItems';
import path from 'path'

const prodEC2Config = {
	storageSize: 400,
	instanceSize: InstanceSize.LARGE
}

const testEC2Config = {
	storageSize: 20,
	instanceSize: InstanceSize.SMALL
}

export class CasheyeAddressWatcherStage extends Stage {	
	public readonly instanceUrl?: CfnOutput;

		constructor(scope: Construct, id: string, props: StageProps & { STAGE: string }) {
		super(scope, id, props);

		const stack = new CasheyeAddressWatcherStack(this, 'stack', {
			STAGE: props.STAGE,
			env: {
				account: process.env.CDK_DEFAULT_ACCOUNT,
				region: 'us-east-1'
			}
		});

		this.instanceUrl = stack.instanceUrl
	}
}

const { initializeEventLambda } = masterLambda({
	runtime: Runtime.NODEJS_12_X,
	code: Code.fromAsset(path.join(__dirname, '../../build')),
})

export class CasheyeAddressWatcherStack extends Stack {
	public readonly instanceUrl?: CfnOutput;

	get availabilityZones(): string[] {
    return ['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d', 'us-east-1e', 'us-east-1f'];
	}
	
	constructor(scope: Construct, id: string, props: StackProps & { STAGE: string }) {
		super(scope, id, props);
		
		const deploymentName = `${serviceName}-${props.STAGE}`;
		const isProd = (props.STAGE === 'prod')

		const documented = [new EventResource(this, {
			Event: btcAddressUsedEvent
		}), new EventResource(this, {
			Event: btcAddressExpiredEvent
		}), new EventResource(this, {
			Event: btcAddressWatchingEvent
		}), new EventResource(this, {
			Event: btcTxDetectedEvent
		}), new EventResource(this, {
			Event: btcConfirmationEvent
		})]
		
		const vpc = new Vpc(this, 'VPC', {
			natGateways: 0,
			cidr: "10.0.0.0/16",
			maxAzs: 2
		});

		const queue = new Queue(this, 'Queue', {
			fifo: true,
			visibilityTimeout: Duration.seconds(5)
		});

		const config = isProd ? prodEC2Config : testEC2Config
		const nodeName = deploymentName + '-node-0'

		const instanceEnv = `NODE_ENV=production STAGE=${props.STAGE} QUEUE_URL=${queue.queueUrl} RPC_USER=$RPC_USER RPC_PASSWORD=$RPC_PASSWORD`

		const shebang = `#!/bin/bash

# install
apt-get update -y
apt install nodejs npm -y

# build
git clone https://github.com/visionsofparadise/${serviceName}.git
cd ${serviceName}
npm i
npm i -g pm2
npm run compile
RPC_USER=$(openssl rand -hex 12)
RPC_PASSWORD=$(openssl rand -hex 12)
${instanceEnv} pm2 start dist/startBTC.js
${instanceEnv} pm2 start dist/startApi.js
${instanceEnv} pm2 start dist/startWatch.js
env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

pm2 save`

		const instance = new Instance(this, 'Instance', {
			instanceName: nodeName,
			vpc,
			vpcSubnets: {
				subnets: vpc.publicSubnets
			},
			instanceType: InstanceType.of(InstanceClass.T2, config.instanceSize),
			machineImage: MachineImage.genericLinux({
				'us-east-1': 'ami-0885b1f6bd170450c'
			}),
			allowAllOutbound: true,
			blockDevices: [
				{
					deviceName: '/dev/sda1',
					volume: BlockDeviceVolume.ebs(config.storageSize),
				},
			],
			userData: UserData.forLinux({
				shebang
			})
		})

		instance.connections.allowFromAnyIpv4(Port.tcp(4000))
		instance.connections.allowFromAnyIpv4(Port.tcp(isProd ? 8333 : 18333))

		EventBus.grantPutEvents(instance.grantPrincipal)
		queue.grantConsumeMessages(instance.grantPrincipal)

		const createEventLambda = initializeEventLambda('casheye-' + props.STAGE)

		const onAddressCreated = createEventLambda(this, 'onAddressCreated', {
			EventLambdaHandler: onAddressCreatedHandler,
			environment: {
				STAGE: props.STAGE,
				QUEUE_URL: queue.queueUrl
			}
		})

		queue.grantSendMessages(onAddressCreated)

		if (props.STAGE !== 'prod') {
			const createOutput = masterOutput(this, deploymentName)

			this.instanceUrl = createOutput('instanceUrl', 'http://' + instance.instancePublicDnsName + ':4000/');
		}

		new DocumentationItems(this, 'DocumentationItems', {
			stage: props.STAGE,
			service: serviceName,
			tableArn: Fn.importValue(`casheye-dynamodb-${props.STAGE}-arn`),
			groups: [
				{
					name: 'AddressWatcher',
					items: documented
				}
			]
		});
	}
}