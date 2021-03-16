import AWS from 'aws-sdk';
import spawnLogger from 'envlog';
import mockSQS from '@abetomo/simply-imitated-sqs'

export const isProd = process.env.STAGE === 'prod';
export const isUnitTest = process.env.UNIT_TEST === 'true';

export const Source = 'casheye-' + process.env.STAGE

export const eventbridge = isUnitTest
	? (({
		putEvents: (_: any) => ({
			promise: () => 'success'
		})
	} as unknown) as AWS.EventBridge)
	: new AWS.EventBridge({ 
			apiVersion: '2015-10-07',
			region: 'us-east-1'
		})

export const sqs = isUnitTest 
	? new mockSQS as AWS.SQS
	: new AWS.SQS({
			apiVersion: '2012-11-05',
			region: 'us-east-1'
		});

export const logger = spawnLogger({
	envKey: 'STAGE',
	offValue: 'prod'
});

export type Network = 'mainnet' | 'testnet' | 'regtest'

export const currencies: { [x: string]: Array<Currency>} = {
	mainnet: ['BTC'],
	testnet: ['BTC-testnet'],
	regtest: ['BTC', 'BTC-testnet']
}

export type Currency = 'BTC' | 'BTC-testnet'

