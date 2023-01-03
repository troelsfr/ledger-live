import type { Transaction, ZilliqaAccount } from "./types";

import { getNonce } from "./logic";
import {
	TxParams,
	TransactionFactory,
	Transaction as ZilliqaTransaction,
} from "@zilliqa-js/account";
import { BN, Long, bytes } from "@zilliqa-js/util";
import {
	zilliqa,
	VERSION,
	getMinimumGasPrice,
	ZILLIQA_TX_GAS_LIMIT,
} from "./api";

export const buildNativeTransaction = async (
	account: ZilliqaAccount,
	toAddr: string,
	nonce: number,
	amount: BN,
	maybeGasPrice?: BN,
	signature?: string
): Promise<ZilliqaTransaction> => {
	console.log("ZILLIQA: buildNativeTransaction.");

	if (!account.zilliqaResources) {
		throw new Error("Zilliqa resources missing on account.");
	}
	const gasPrice = maybeGasPrice || (await getMinimumGasPrice());
	const gasLimit = new Long(ZILLIQA_TX_GAS_LIMIT);

	const params: TxParams = {
		version: VERSION,
		toAddr,
		amount,
		gasPrice,
		gasLimit,
		nonce: nonce,
		pubKey: account.zilliqaResources
			? account.zilliqaResources.publicKey
			: "",
		code: "",
		data: "",
		signature,
	};
	const tx = new ZilliqaTransaction(params, zilliqa.provider);
	return tx;
};

/**
 *
 * @param {Account} a
 * @param {Transaction} t
 */
export const buildTransaction = async (a: ZilliqaAccount, t: Transaction) => {
	console.log("ZILLIQA: buildTransaction.");
	console.log("TRANSACTION:", t);
	const tx = await buildNativeTransaction(
		a,
		t.recipient,
		getNonce(a),
		new BN(t.amount.toString()),
		await getMinimumGasPrice()
	);

	console.log("TX:", tx.txParams);
	console.log("Gas limit:", tx.txParams.gasLimit.toString());
	console.log("Gas price:", tx.txParams.gasPrice.toString());
	console.log("Amount:", tx.txParams.amount.toString());

	return tx.bytes.toString("hex");
};