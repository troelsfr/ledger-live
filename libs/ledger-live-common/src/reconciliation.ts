// reconciliation by the React definition. https://reactjs.org/docs/reconciliation.html
import isEqual from "lodash/isEqual";
import { BigNumber } from "bignumber.js";
import { sameOp } from "./bridge/jsHelpers";
import type {
  Operation,
  OperationRaw,
  Account,
  AccountLike,
  AccountRaw,
  SubAccount,
  SubAccountRaw,
  BalanceHistoryCache,
} from "@ledgerhq/types-live";
import {
  fromAccountRaw,
  fromOperationRaw,
  fromSubAccountRaw,
  fromBitcoinResourcesRaw,
  fromPolkadotResourcesRaw,
  fromCryptoOrgResourcesRaw,
  fromZilliqaResourcesRaw,
  fromNFTRaw,
  toPolkadotResourcesRaw,
  toCryptoOrgResourcesRaw,
  toZilliqaResourcesRaw,
} from "./account";
import consoleWarnExpectToEqual from "./consoleWarnExpectToEqual";
import { BitcoinAccount, BitcoinAccountRaw } from "./families/bitcoin/types";
import {
  CryptoOrgAccount,
  CryptoOrgAccountRaw,
} from "./families/crypto_org/types";
import { PolkadotAccount, PolkadotAccountRaw } from "./families/polkadot/types";
import { ZilliqaAccount, ZilliqaAccountRaw } from "./families/zilliqa/types";
import { getAccountBridge } from "./bridge";

// aim to build operations with the minimal diff & call to coin implementation possible
export async function minimalOperationsBuilder<CO>(
  existingOperations: Operation[],
  coreOperations: CO[],
  buildOp: (coreOperation: CO) => Promise<Operation | null | undefined>, // if defined, allows to merge some consecutive operation that have same hash
  mergeSameHashOps?: (arg0: Operation[]) => Operation
): Promise<Operation[]> {
  if (existingOperations.length === 0 && coreOperations.length === 0) {
    return existingOperations;
  }

  const state: StepBuilderState = {
    finished: false,
    operations: [],
    existingOps: existingOperations || [],
    immutableOpCmpDoneOnce: false,
  };
  let operationWithSameHash: Operation[] = [];

  for (let i = coreOperations.length - 1; i >= 0; i--) {
    const coreOperation = coreOperations[i];
    const op = await buildOp(coreOperation);
    if (!op) continue; // some operation can be skipped by implementation

    let newOp;

    if (mergeSameHashOps) {
      if (
        operationWithSameHash.length === 0 ||
        operationWithSameHash[0].hash === op.hash
      ) {
        // we accumulate consecutive op of same hash in operationWithSameHash
        operationWithSameHash.push(op);
        continue;
      }

      // when the new op no longer matches the one accumulated,
      // we can "release" one operation resulting of merging the accumulation
      newOp = mergeSameHashOps(operationWithSameHash);
      operationWithSameHash = [op];
    } else {
      // mergeSameHashOps not used = normal iteration
      newOp = op;
    }

    stepBuilder(state, newOp, i);

    if (state.finished) {
      return state.operations;
    }
  }

  if (mergeSameHashOps && operationWithSameHash.length) {
    stepBuilder(state, mergeSameHashOps(operationWithSameHash), 0);
  }

  return state.operations;
}
export function minimalOperationsBuilderSync<CO>(
  existingOperations: Operation[],
  coreOperations: CO[],
  buildOp: (coreOperation: CO) => Operation | null | undefined
): Operation[] {
  if (existingOperations.length === 0 && coreOperations.length === 0) {
    return existingOperations;
  }

  const state: StepBuilderState = {
    finished: false,
    operations: [],
    existingOps: existingOperations || [],
    immutableOpCmpDoneOnce: false,
  };

  for (let i = coreOperations.length - 1; i >= 0; i--) {
    const coreOperation = coreOperations[i];
    const newOp = buildOp(coreOperation);
    if (!newOp) continue;
    stepBuilder(state, newOp, i);

    if (state.finished) {
      return state.operations;
    }
  }

  return state.operations;
}

const shouldRefreshBalanceHistoryCache = (
  balanceHistoryCache: BalanceHistoryCache,
  account: AccountLike
): boolean => {
  const oldH = account.balanceHistoryCache.HOUR;
  const newH = balanceHistoryCache.HOUR;
  if (oldH.latestDate !== newH.latestDate) return true; // date have changed, need to refresh the array

  if (oldH.balances.length !== newH.balances.length) return true; // balances length changes (new ops for instance)

  const length = newH.balances.length;
  if (length === 0) return false;
  if (oldH.balances[length - 1] !== newH.balances[length - 1]) return true; // latest datapoint changes.

  return false;
};

function shouldRefreshBitcoinResources(
  updatedRaw: AccountRaw,
  account: Account
) {
  if (!(updatedRaw as BitcoinAccountRaw).bitcoinResources) return false;
  if (!(account as BitcoinAccount).bitcoinResources) return true;
  if (updatedRaw.blockHeight !== account.blockHeight) return true;
  if (updatedRaw.operations.length !== account.operations.length) return true;
  const { bitcoinResources: existing } = account as BitcoinAccount;
  const { bitcoinResources: raw } = updatedRaw as BitcoinAccountRaw;
  // FIXME Need more typing in wallet-btc to have a meaningful comparison
  //if (!isEqual(raw.walletAccount?.xpub?.data, existing.walletAccount?.xpub?.data)) return true;
  if (raw.utxos.length !== existing.utxos.length) return true;
  return !isEqual(raw.utxos, existing.utxos);
}

export function patchAccount(
  account: Account,
  updatedRaw: AccountRaw
): Account {
  // id can change after a sync typically if changing the version or filling more info. in that case we consider all changes.
  if (account.id !== updatedRaw.id) return fromAccountRaw(updatedRaw);
  let subAccounts;

  if (updatedRaw.subAccounts) {
    const existingSubAccounts = account.subAccounts || [];
    let subAccountsChanged =
      updatedRaw.subAccounts.length !== existingSubAccounts.length;
    subAccounts = updatedRaw.subAccounts.map((ta) => {
      const existing = existingSubAccounts.find((t) => t.id === ta.id);
      const patched = patchSubAccount(existing, ta);

      if (patched !== existing) {
        subAccountsChanged = true;
      }

      return patched;
    });

    if (!subAccountsChanged) {
      subAccounts = existingSubAccounts;
    }
  }

  const operations = patchOperations(
    account.operations,
    updatedRaw.operations,
    updatedRaw.id,
    subAccounts
  );
  const pendingOperations = patchOperations(
    account.pendingOperations,
    updatedRaw.pendingOperations,
    updatedRaw.id,
    subAccounts
  );
  const next: Account = { ...account };
  let changed = false;

  if (subAccounts && account.subAccounts !== subAccounts) {
    next.subAccounts = subAccounts;
    changed = true;
  }

  if (account.operations !== operations) {
    next.operations = operations;
    changed = true;
  }

  if (
    account.operationsCount !== updatedRaw.operationsCount &&
    updatedRaw.operationsCount
  ) {
    next.operationsCount = updatedRaw.operationsCount;
    changed = true;
  }

  if (account.pendingOperations !== pendingOperations) {
    next.pendingOperations = pendingOperations;
    changed = true;
  }

  if (updatedRaw.balance !== account.balance.toString()) {
    next.balance = new BigNumber(updatedRaw.balance);
    changed = true;
  }

  if (updatedRaw.spendableBalance !== account.spendableBalance.toString()) {
    next.spendableBalance = new BigNumber(
      updatedRaw.spendableBalance || updatedRaw.balance
    );
    changed = true;
  }

  if (updatedRaw.lastSyncDate !== account.lastSyncDate.toISOString()) {
    next.lastSyncDate = new Date(updatedRaw.lastSyncDate);
    changed = true;
  }

  if (
    updatedRaw.creationDate &&
    updatedRaw.creationDate !== account.creationDate.toISOString()
  ) {
    next.creationDate = new Date(updatedRaw.creationDate);
    changed = true;
  }

  if (account.freshAddress !== updatedRaw.freshAddress) {
    next.freshAddress = updatedRaw.freshAddress;
    changed = true;
  }

  if (account.freshAddressPath !== updatedRaw.freshAddressPath) {
    next.freshAddressPath = updatedRaw.freshAddressPath;
    changed = true;
  }

  if (account.blockHeight !== updatedRaw.blockHeight) {
    next.blockHeight = updatedRaw.blockHeight;
    changed = true;
  }

  if (account.syncHash !== updatedRaw.syncHash) {
    next.syncHash = updatedRaw.syncHash;
    changed = true;
  }

  const { balanceHistoryCache } = updatedRaw;

  if (balanceHistoryCache) {
    if (shouldRefreshBalanceHistoryCache(balanceHistoryCache, account)) {
      next.balanceHistoryCache = balanceHistoryCache;
      changed = true;
    }
  }

  // TODO This will be reworked to belong in each coin family
  // Temporary logic to patch resources for each coin is:
  // - there is raw data to patch from
  // AND
  //   - there is no current account data
  //   OR
  //   - current account data is different
  switch (account.currency.family) {
    case "bitcoin": {
      if (shouldRefreshBitcoinResources(updatedRaw, account)) {
        (next as BitcoinAccount).bitcoinResources = fromBitcoinResourcesRaw(
          (updatedRaw as BitcoinAccountRaw).bitcoinResources
        );
      }
      break;
    }
    case "polkadot": {
      const polkadotAcc = account as PolkadotAccount;
      const polkadotUpdatedRaw = updatedRaw as PolkadotAccountRaw;
      if (
        polkadotUpdatedRaw.polkadotResources &&
        (!polkadotAcc.polkadotResources ||
          !areSameResources(
            toPolkadotResourcesRaw(polkadotAcc.polkadotResources),
            polkadotUpdatedRaw.polkadotResources
          ))
      ) {
        (next as PolkadotAccount).polkadotResources = fromPolkadotResourcesRaw(
          polkadotUpdatedRaw.polkadotResources
        );
        changed = true;
      }
      break;
    }
    case "zilliqa": {
      const zilliqaAcc = account as ZilliqaAccount;
      const zilliqaUpdatedRaw = updatedRaw as ZilliqaAccountRaw;
      if (
        zilliqaUpdatedRaw.zilliqaResources &&
        (!zilliqaAcc.zilliqaResources ||
          !areSameResources(
            toZilliqaResourcesRaw(zilliqaAcc.zilliqaResources),
            zilliqaUpdatedRaw.zilliqaResources
          ))
      ) {
        (next as ZilliqaAccount).zilliqaResources = fromZilliqaResourcesRaw(
          zilliqaUpdatedRaw.zilliqaResources
        );
        changed = true;
      }
      break;
    }
    case "crypto_org": {
      const cryptoOrgAcc = account as CryptoOrgAccount;
      const cryptoOrgUpdatedRaw = updatedRaw as CryptoOrgAccountRaw;
      if (
        cryptoOrgUpdatedRaw.cryptoOrgResources &&
        (!cryptoOrgAcc.cryptoOrgResources ||
          !areSameResources(
            toCryptoOrgResourcesRaw(cryptoOrgAcc.cryptoOrgResources),
            cryptoOrgUpdatedRaw.cryptoOrgResources
          ))
      ) {
        (next as CryptoOrgAccount).cryptoOrgResources = fromCryptoOrgResourcesRaw(
          cryptoOrgUpdatedRaw.cryptoOrgResources
        );
        changed = true;
      }
      break;
    }
    default: {
      const bridge = getAccountBridge(account);
      const applyReconciliation = bridge.applyReconciliation;
      if (applyReconciliation) {
        changed = changed || applyReconciliation(account, updatedRaw, next);
      }
    }
  }

  const nfts = updatedRaw?.nfts?.map(fromNFTRaw);
  if (!updatedRaw.nfts && account.nfts) {
    delete next.nfts;
    changed = true;
  } else if (!isEqual(account.nfts, nfts)) {
    next.nfts = nfts;
    changed = true;
  }

  if (!changed) return account; // nothing changed at all

  return next;
}
export function patchSubAccount(
  account: SubAccount | null | undefined,
  updatedRaw: SubAccountRaw
): SubAccount {
  // id can change after a sync typically if changing the version or filling more info. in that case we consider all changes.
  if (
    !account ||
    account.id !== updatedRaw.id ||
    account.parentId !== updatedRaw.parentId
  ) {
    return fromSubAccountRaw(updatedRaw);
  }

  const operations = patchOperations(
    account.operations,
    updatedRaw.operations,
    updatedRaw.id,
    undefined
  );
  const pendingOperations = patchOperations(
    account.pendingOperations,
    updatedRaw.pendingOperations,
    updatedRaw.id,
    undefined
  );
  // $FlowFixMe destructing union type?
  const next: SubAccount = { ...account };
  let changed = false;

  if (
    account.operationsCount !== updatedRaw.operationsCount &&
    updatedRaw.operationsCount
  ) {
    next.operationsCount = updatedRaw.operationsCount;
    changed = true;
  }

  if (
    updatedRaw.creationDate &&
    updatedRaw.creationDate !== account.creationDate.toISOString()
  ) {
    next.creationDate = new Date(updatedRaw.creationDate);
    changed = true;
  }

  if (account.operations !== operations) {
    next.operations = operations;
    changed = true;
  }

  if (account.pendingOperations !== pendingOperations) {
    next.pendingOperations = pendingOperations;
    changed = true;
  }

  if (updatedRaw.balance !== account.balance.toString()) {
    next.balance = new BigNumber(updatedRaw.balance);
    changed = true;
  }

  if (
    next.type === "TokenAccount" &&
    account.type === "TokenAccount" &&
    updatedRaw.type === "TokenAccountRaw"
  ) {
    if (updatedRaw.spendableBalance !== account.spendableBalance.toString()) {
      next.spendableBalance = new BigNumber(
        updatedRaw.spendableBalance || updatedRaw.balance
      );
      changed = true;
    }

    if (updatedRaw.compoundBalance !== account.compoundBalance?.toString()) {
      next.compoundBalance = updatedRaw.compoundBalance
        ? new BigNumber(updatedRaw.compoundBalance)
        : undefined;
      changed = true;
    }

    if (
      updatedRaw.approvals &&
      !isEqual(updatedRaw.approvals, account.approvals)
    ) {
      next.approvals = updatedRaw.approvals;
      changed = true;
    }
  }

  const { balanceHistoryCache } = updatedRaw;

  if (balanceHistoryCache) {
    if (shouldRefreshBalanceHistoryCache(balanceHistoryCache, account)) {
      next.balanceHistoryCache = balanceHistoryCache;
      changed = true;
    }
  }

  if (!changed) return account; // nothing changed at all

  return next;
}
export function patchOperations(
  operations: Operation[],
  updated: OperationRaw[],
  accountId: string,
  subAccounts: SubAccount[] | null | undefined
): Operation[] {
  return minimalOperationsBuilderSync(
    operations,
    updated.slice(0).reverse(),
    (raw) => fromOperationRaw(raw, accountId, subAccounts)
  );
}

function findExistingOp(ops, op) {
  return ops.find((o) => o.id === op.id);
}

type StepBuilderState = {
  operations: Operation[];
  existingOps: Operation[];
  immutableOpCmpDoneOnce: boolean;
  finished: boolean;
};

// This is one step of the logic of minimalOperationsBuilder
// it implements an heuristic to skip prematurely the operations loop
// as soon as we find an existing operation that matches newOp
function stepBuilder(state, newOp, i) {
  const existingOp = findExistingOp(state.existingOps, newOp);

  if (existingOp && !state.immutableOpCmpDoneOnce) {
    // an Operation is supposedly immutable.
    if (existingOp.blockHeight !== newOp.blockHeight) {
      // except for blockHeight that can temporarily be null
      state.operations.push(newOp);
      return;
    } else {
      state.immutableOpCmpDoneOnce = true;

      // we still check the first existing op we meet...
      if (!sameOp(existingOp, newOp)) {
        // this implement a failsafe in case an op changes (when we fix bugs)
        // trade-off: in such case, we assume all existingOps are to trash
        consoleWarnExpectToEqual(
          newOp,
          existingOp,
          "op mismatch. doing a full clear cache."
        );
        state.existingOps = [];
        state.operations.push(newOp);
        return;
      }
    }
  }

  if (existingOp) {
    // as soon as we've found a first matching op in old op list,
    const j = state.existingOps.indexOf(existingOp);
    const rest = state.existingOps.slice(j);

    if (rest.length > i + 1) {
      // if coin implementation happen to have less ops that what we had,
      // we actually need to continue because we don't know where hole will be,
      // but we can keep existingOp
      state.operations.push(existingOp);
    } else {
      // otherwise we stop the coin implementation iteration and continue with previous data
      // and we're done on the iteration
      if (state.operations.length === 0 && j === 0) {
        // special case: we preserve the operations array as much as possible
        state.operations = state.existingOps;
      } else {
        state.operations = state.operations.concat(rest);
      }

      state.finished = true;
      return;
    }
  } else {
    // otherwise it's a new op
    state.operations.push(newOp);
  }
}

export function areSameResources(a: any, b: any) {
  return isEqual(a, b);
}
