import { Event } from 'xkore-lambda-helpers/dist/Event';
import { jsonObjectSchemaGenerator } from 'xkore-lambda-helpers/dist/jsonObjectSchemaGenerator';
import { eventbridge, logger, Network } from './helpers';
import { rpc } from './rpc'

interface GetTransactionResponse {
	txid: string;
	confirmations: number;
	amount: number;
	network: Network
	details: Array<{
		address: string;
		category: string;
		label: string;
	}>;
}

type BtcTxDetectedDetail = GetTransactionResponse

export const btcTxDetectedEvent = new Event<BtcTxDetectedDetail>({
	source: 'casheye-' + process.env.STAGE,
	eventbridge,
	detailType: 'btcTxDetected',
	detailJSONSchema: jsonObjectSchemaGenerator<BtcTxDetectedDetail>({
		description: 'Triggered when an address is being watched for transactions and confirmations.',
		properties: {
			txid: { type: 'string' },
			confirmations: { type: 'number' },
			amount: { type: 'number' },
			network: { type: 'string' },
			details: { type: 'array', items: jsonObjectSchemaGenerator<BtcTxDetectedDetail['details'][number]>({ 
				properties: {
					address: { type: 'string' },
					category: { type: 'string' },
					label: { type: 'string' }
				}
			})}
		}
	})
});

export const txDetected = async (txId: string) => {
	const tx = (await rpc.getTransaction(txId, true)) as GetTransactionResponse;

	if (tx.confirmations !== 0) return 

	logger.info({tx})

	const addresses = tx.details.filter(detail => detail.category === 'receive' && detail.label === 'watching')

	await Promise.all(addresses.map(async address => {
		await rpc.setLabel(address.address, 'confirming');

		await btcTxDetectedEvent.send({
			...tx,
			network: process.env.NETWORK as Network
		})

		return
	}))

	return;
};
