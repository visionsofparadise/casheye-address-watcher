import upick from 'upick';
import { eventbridge, logger, Currency, currencies, Network } from './helpers';
import { jsonObjectSchemaGenerator } from 'xkore-lambda-helpers/dist/jsonObjectSchemaGenerator'
import { Event } from 'xkore-lambda-helpers/dist/Event'
import { rpc } from './rpc'

interface BtcAddressUsedDetail {
	txid: string;
	address: string;
	confirmations: number;
	currency: Currency
}

export const btcAddressUsedEvent = new Event<BtcAddressUsedDetail>({
	source: 'casheye-' + process.env.STAGE,
	eventbridge,
	detailType: 'btcAddressUsed',
	detailJSONSchema: jsonObjectSchemaGenerator<BtcAddressUsedDetail>({
		description: 'Triggered when a address recieves a transaction and that transaction is confirmed 6 times.',
		properties: {
			txid: { type: 'string' },
			address: { type: 'string' },
			confirmations: { type: 'number' },
			currency: { type: 'string' },
		}
	})
});

type BtcConfirmationDetail = BtcAddressUsedDetail

export const btcConfirmationEvent = new Event<BtcConfirmationDetail>({
	source: 'casheye-' + process.env.STAGE,
	eventbridge,
	detailType: 'btcConfirmation',
	detailJSONSchema: jsonObjectSchemaGenerator<BtcConfirmationDetail>({
		description: 'Triggered when a transaction is confirmed.',
		properties: {
			txid: { type: 'string' },
			address: { type: 'string' },
			confirmations: { type: 'number' },
			currency: { type: 'string' },
		}
	})
});

type ListTransactionsResponse = Array<BtcAddressUsedDetail>;

export const confirm = async () => {
	const page = async (pageNumber: number): Promise<void> => {
		const txs = (await rpc.listTransactions('confirming', 100, pageNumber * 100, true)) as ListTransactionsResponse;

		if (txs.length === 0) return

		logger.info({ txs })

		const over6Txs = txs.filter(tx => tx.confirmations >= 6)

		for (let i = 0; i < Math.ceil(txs.length / 10); i++) {
			const index = i * 10
			const endIndex = index + 10
			
			await btcConfirmationEvent.send(txs.slice(index, endIndex > txs.length ? txs.length : endIndex).map(tx => ({
				currency: currencies[process.env.NETWORK! as Network][0] as Currency,
				...upick(tx, ['txid', 'address', 'confirmations'])
			})))
		}

		await rpc.command(over6Txs.map(tx => ({
			method: 'setlabel',
			parameters: [tx.address, 'used']
		})))

		for (let i = 0; i < Math.ceil(over6Txs.length / 10); i++) {
			const index = i * 10
			const endIndex = index + 10
			
			await btcAddressUsedEvent.send(over6Txs.slice(index, endIndex > txs.length ? txs.length : endIndex).map(tx => ({
				currency: currencies[process.env.NETWORK! as Network][0] as Currency,
				...upick(tx, ['txid', 'address', 'confirmations'])
			})))
		}

		if (txs.length === 100) setTimeout(() => page(pageNumber + 1), 1000)

		return;
	};

	await page(0);
};
