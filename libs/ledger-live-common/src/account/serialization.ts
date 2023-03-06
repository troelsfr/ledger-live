import { BigNumber } from "bignumber.js";
import {
  getCryptoCurrencyById,
  findCryptoCurrencyById,
  getTokenById,
  findTokenById,
} from "../currencies";
import accountByFamily from "../generated/account";
import { isAccountEmpty } from "./helpers";
import type { SwapOperation, SwapOperationRaw } from "../exchange/swap/types";
import {
  emptyHistoryCache,
  generateHistoryFromOperations,
} from "@ledgerhq/coin-framework/account/balanceHistoryCache";
import { inferFamilyFromAccountId } from "@ledgerhq/coin-framework/account/index";

import type {
  Account,
  AccountLike,
  AccountRaw,
  AccountRawLike,
  BalanceHistory,
  BalanceHistoryRaw,
  ChildAccount,
  ChildAccountRaw,
  Operation,
  OperationRaw,
  ProtoNFT,
  ProtoNFTRaw,
  SubAccount,
  SubAccountRaw,
  TokenAccount,
  TokenAccountRaw,
} from "@ledgerhq/types-live";
import {
  toOperationRaw as commonToOperationRaw,
  fromOperationRaw as commonFromOperationRaw,
} from "@ledgerhq/coin-framework/account/serialization";
import { getAccountBridge } from "../bridge";

export function toBalanceHistoryRaw(b: BalanceHistory): BalanceHistoryRaw {
  return b.map(({ date, value }) => [date.toISOString(), value.toString()]);
}
export function fromBalanceHistoryRaw(b: BalanceHistoryRaw): BalanceHistory {
  return b.map(([date, value]) => ({
    date: new Date(date),
    value: parseFloat(value),
  }));
}
export const toOperationRaw = (
  operation: Operation,
  preserveSubOperation?: boolean
): OperationRaw => {
  const copy: OperationRaw = commonToOperationRaw(
    operation,
    preserveSubOperation
  );

  let e = copy.extra;

  if (e) {
    const family = inferFamilyFromAccountId(copy.accountId);

    if (family) {
      const abf = accountByFamily[family];

      if (abf && abf.toOperationExtraRaw) {
        e = abf.toOperationExtraRaw(e);
      }
    }
  }

  return {
    ...copy,
    extra: e,
  };
};
export { inferSubOperations } from "@ledgerhq/coin-framework/account/serialization";
export const fromOperationRaw = (
  operation: OperationRaw,
  accountId: string,
  subAccounts?: SubAccount[] | null | undefined
): Operation => {
  const res: Operation = commonFromOperationRaw(
    operation,
    accountId,
    subAccounts
  );

  let e = res.extra;

  if (e) {
    const family = inferFamilyFromAccountId(res.accountId);

    if (family) {
      const abf = accountByFamily[family];

      if (abf && abf.fromOperationExtraRaw) {
        e = abf.fromOperationExtraRaw(e);
      }
    }
  }

  return {
    ...res,
    extra: e || {},
    contract,
    operator,
    standard,
    tokenId,
  };

  if (transactionSequenceNumber !== undefined) {
    res.transactionSequenceNumber = transactionSequenceNumber;
  }

  if (hasFailed !== undefined) {
    res.hasFailed = hasFailed;
  }

  if (subAccounts) {
    res.subOperations = inferSubOperations(hash, subAccounts);
  } else if (subOperations) {
    res.subOperations = subOperations.map((o) =>
      fromOperationRaw(o, o.accountId)
    );
  }

  if (internalOperations) {
    res.internalOperations = internalOperations.map((o) =>
      fromOperationRaw(o, o.accountId)
    );
  }

  if (nftOperations) {
    res.nftOperations = nftOperations.map((o) =>
      fromOperationRaw(o, o.accountId)
    );
  }

  return res;
};
export const toTronResourcesRaw = ({
  frozen,
  delegatedFrozen,
  votes,
  tronPower,
  energy,
  bandwidth,
  unwithdrawnReward,
  lastWithdrawnRewardDate,
  lastVotedDate,
  cacheTransactionInfoById: cacheTx,
}: TronResources): TronResourcesRaw => {
  const frozenBandwidth = frozen.bandwidth;
  const frozenEnergy = frozen.energy;
  const delegatedFrozenBandwidth = delegatedFrozen.bandwidth;
  const delegatedFrozenEnergy = delegatedFrozen.energy;
  const cacheTransactionInfoById = {};

  for (const k in cacheTx) {
    const { fee, blockNumber, withdraw_amount, unfreeze_amount } = cacheTx[k];
    cacheTransactionInfoById[k] = [
      fee,
      blockNumber,
      withdraw_amount,
      unfreeze_amount,
    ];
  }

  return {
    frozen: {
      bandwidth: frozenBandwidth
        ? {
            amount: frozenBandwidth.amount.toString(),
            expiredAt: frozenBandwidth.expiredAt.toISOString(),
          }
        : undefined,
      energy: frozenEnergy
        ? {
            amount: frozenEnergy.amount.toString(),
            expiredAt: frozenEnergy.expiredAt.toISOString(),
          }
        : undefined,
    },
    delegatedFrozen: {
      bandwidth: delegatedFrozenBandwidth
        ? {
            amount: delegatedFrozenBandwidth.amount.toString(),
          }
        : undefined,
      energy: delegatedFrozenEnergy
        ? {
            amount: delegatedFrozenEnergy.amount.toString(),
          }
        : undefined,
    },
    votes,
    tronPower,
    energy: energy.toString(),
    bandwidth: {
      freeUsed: bandwidth.freeUsed.toString(),
      freeLimit: bandwidth.freeLimit.toString(),
      gainedUsed: bandwidth.gainedUsed.toString(),
      gainedLimit: bandwidth.gainedLimit.toString(),
    },
    unwithdrawnReward: unwithdrawnReward.toString(),
    lastWithdrawnRewardDate: lastWithdrawnRewardDate
      ? lastWithdrawnRewardDate.toISOString()
      : undefined,
    lastVotedDate: lastVotedDate ? lastVotedDate.toISOString() : undefined,
    cacheTransactionInfoById,
  };
};
export const fromTronResourcesRaw = ({
  frozen,
  delegatedFrozen,
  votes,
  tronPower,
  energy,
  bandwidth,
  unwithdrawnReward,
  lastWithdrawnRewardDate,
  lastVotedDate,
  cacheTransactionInfoById: cacheTransactionInfoByIdRaw,
}: TronResourcesRaw): TronResources => {
  const frozenBandwidth = frozen.bandwidth;
  const frozenEnergy = frozen.energy;
  const delegatedFrozenBandwidth = delegatedFrozen.bandwidth;
  const delegatedFrozenEnergy = delegatedFrozen.energy;
  const cacheTransactionInfoById = {};

  if (cacheTransactionInfoByIdRaw) {
    for (const k in cacheTransactionInfoByIdRaw) {
      const [fee, blockNumber, withdraw_amount, unfreeze_amount] =
        cacheTransactionInfoByIdRaw[k];
      cacheTransactionInfoById[k] = {
        fee,
        blockNumber,
        withdraw_amount,
        unfreeze_amount,
      };
    }
  }

  return {
    frozen: {
      bandwidth: frozenBandwidth
        ? {
            amount: new BigNumber(frozenBandwidth.amount),
            expiredAt: new Date(frozenBandwidth.expiredAt),
          }
        : undefined,
      energy: frozenEnergy
        ? {
            amount: new BigNumber(frozenEnergy.amount),
            expiredAt: new Date(frozenEnergy.expiredAt),
          }
        : undefined,
    },
    delegatedFrozen: {
      bandwidth: delegatedFrozenBandwidth
        ? {
            amount: new BigNumber(delegatedFrozenBandwidth.amount),
          }
        : undefined,
      energy: delegatedFrozenEnergy
        ? {
            amount: new BigNumber(delegatedFrozenEnergy.amount),
          }
        : undefined,
    },
    votes,
    tronPower,
    energy: new BigNumber(energy),
    bandwidth: {
      freeUsed: new BigNumber(bandwidth.freeUsed),
      freeLimit: new BigNumber(bandwidth.freeLimit),
      gainedUsed: new BigNumber(bandwidth.gainedUsed),
      gainedLimit: new BigNumber(bandwidth.gainedLimit),
    },
    unwithdrawnReward: new BigNumber(unwithdrawnReward),
    lastWithdrawnRewardDate: lastWithdrawnRewardDate
      ? new Date(lastWithdrawnRewardDate)
      : undefined,
    lastVotedDate: lastVotedDate ? new Date(lastVotedDate) : undefined,
    cacheTransactionInfoById,
  };
};
export function fromSwapOperationRaw(raw: SwapOperationRaw): SwapOperation {
  const { fromAmount, toAmount } = raw;
  return {
    ...raw,
    fromAmount: new BigNumber(fromAmount),
    toAmount: new BigNumber(toAmount),
  };
}
export function toSwapOperationRaw(so: SwapOperation): SwapOperationRaw {
  const { fromAmount, toAmount } = so;
  return {
    ...so,
    fromAmount: fromAmount.toString(),
    toAmount: toAmount.toString(),
  };
}
export function fromTokenAccountRaw(raw: TokenAccountRaw): TokenAccount {
  const {
    id,
    parentId,
    tokenId,
    starred,
    operations,
    pendingOperations,
    creationDate,
    balance,
    spendableBalance,
    balanceHistoryCache,
    swapHistory,
    approvals,
  } = raw;
  const token = getTokenById(tokenId);

  const convertOperation = (op) => fromOperationRaw(op, id);

  const res = {
    type: "TokenAccount",
    id,
    parentId,
    token,
    starred: starred || false,
    balance: new BigNumber(balance),
    spendableBalance: spendableBalance
      ? new BigNumber(spendableBalance)
      : new BigNumber(balance),
    creationDate: new Date(creationDate || Date.now()),
    operationsCount:
      raw.operationsCount || (operations && operations.length) || 0,
    operations: (operations || []).map(convertOperation),
    pendingOperations: (pendingOperations || []).map(convertOperation),
    swapHistory: (swapHistory || []).map(fromSwapOperationRaw),
    approvals,
    balanceHistoryCache: balanceHistoryCache || emptyHistoryCache,
  };
  res.balanceHistoryCache = generateHistoryFromOperations(res as TokenAccount);
  return res as TokenAccount;
}
export function toTokenAccountRaw(ta: TokenAccount): TokenAccountRaw {
  const {
    id,
    parentId,
    token,
    starred,
    operations,
    operationsCount,
    pendingOperations,
    balance,
    spendableBalance,
    balanceHistoryCache,
    swapHistory,
    approvals,
  } = ta;
  return {
    type: "TokenAccountRaw",
    id,
    parentId,
    starred,
    tokenId: token.id,
    balance: balance.toString(),
    spendableBalance: spendableBalance.toString(),
    balanceHistoryCache,
    creationDate: ta.creationDate.toISOString(),
    operationsCount,
    operations: operations.map((o) => toOperationRaw(o)),
    pendingOperations: pendingOperations.map((o) => toOperationRaw(o)),
    swapHistory: (swapHistory || []).map(toSwapOperationRaw),
    approvals,
  };
}
export function fromChildAccountRaw(raw: ChildAccountRaw): ChildAccount {
  const {
    id,
    name,
    parentId,
    currencyId,
    starred,
    creationDate,
    operations,
    operationsCount,
    pendingOperations,
    balance,
    address,
    balanceHistoryCache,
    swapHistory,
  } = raw;
  const currency = getCryptoCurrencyById(currencyId);

  const convertOperation = (op) => fromOperationRaw(op, id);

  const res: ChildAccount = {
    type: "ChildAccount",
    id,
    name,
    starred: starred || false,
    parentId,
    currency,
    address,
    balance: new BigNumber(balance),
    creationDate: new Date(creationDate || Date.now()),
    operationsCount: operationsCount || (operations && operations.length) || 0,
    operations: (operations || []).map(convertOperation),
    pendingOperations: (pendingOperations || []).map(convertOperation),
    swapHistory: (swapHistory || []).map(fromSwapOperationRaw),
    balanceHistoryCache: balanceHistoryCache || emptyHistoryCache,
  };
  res.balanceHistoryCache = generateHistoryFromOperations(res);
  return res;
}
export function toChildAccountRaw(ca: ChildAccount): ChildAccountRaw {
  const {
    id,
    name,
    parentId,
    starred,
    currency,
    operations,
    operationsCount,
    pendingOperations,
    balance,
    balanceHistoryCache,
    address,
    creationDate,
    swapHistory,
  } = ca;
  return {
    type: "ChildAccountRaw",
    id,
    name,
    starred,
    parentId,
    address,
    operationsCount,
    currencyId: currency.id,
    balance: balance.toString(),
    balanceHistoryCache,
    creationDate: creationDate.toISOString(),
    operations: operations.map((o) => toOperationRaw(o)),
    pendingOperations: pendingOperations.map((o) => toOperationRaw(o)),
    swapHistory: (swapHistory || []).map(toSwapOperationRaw),
  };
}
export function fromSubAccountRaw(raw: SubAccountRaw): SubAccount {
  switch (raw.type) {
    case "ChildAccountRaw":
      return fromChildAccountRaw(raw);

    case "TokenAccountRaw":
      return fromTokenAccountRaw(raw);

    default:
      throw new Error("invalid raw.type=" + (raw as SubAccountRaw).type);
  }
}
export function toSubAccountRaw(subAccount: SubAccount): SubAccountRaw {
  switch (subAccount.type) {
    case "ChildAccount":
      return toChildAccountRaw(subAccount);

    case "TokenAccount":
      return toTokenAccountRaw(subAccount);

    default:
      throw new Error(
        "invalid subAccount.type=" + (subAccount as SubAccount).type
      );
  }
}
export function fromAccountLikeRaw(
  rawAccountLike: AccountRawLike
): AccountLike {
  if ("type" in rawAccountLike) {
    //$FlowFixMe
    return fromSubAccountRaw(rawAccountLike);
  }

  //$FlowFixMe
  return fromAccountRaw(rawAccountLike);
}
export function toAccountLikeRaw(accountLike: AccountLike): AccountRawLike {
  switch (accountLike.type) {
    case "Account":
      return toAccountRaw(accountLike);

    default:
      return toSubAccountRaw(accountLike);
  }
}
export function fromAccountRaw(rawAccount: AccountRaw): Account {
  const {
    id,
    seedIdentifier,
    derivationMode,
    index,
    xpub,
    starred,
    used,
    freshAddress,
    freshAddressPath,
    freshAddresses,
    name,
    blockHeight,
    endpointConfig,
    currencyId,
    feesCurrencyId,
    unitMagnitude,
    operations,
    operationsCount,
    pendingOperations,
    lastSyncDate,
    creationDate,
    balance,
    balanceHistoryCache,
    spendableBalance,
    subAccounts: subAccountsRaw,
    swapHistory,
    syncHash,
    nfts,
  } = rawAccount;

  const subAccounts =
    subAccountsRaw &&
    subAccountsRaw
      .map((ta) => {
        if (ta.type === "TokenAccountRaw") {
          if (findTokenById(ta.tokenId)) {
            return fromTokenAccountRaw(ta);
          }
        } else {
          return fromSubAccountRaw(ta);
        }
      })
      .filter(Boolean);
  const currency = getCryptoCurrencyById(currencyId);
  const feesCurrency =
    (feesCurrencyId &&
      (findCryptoCurrencyById(feesCurrencyId) ||
        findTokenById(feesCurrencyId))) ||
    undefined;
  const unit =
    currency.units.find((u) => u.magnitude === unitMagnitude) ||
    currency.units[0];

  const convertOperation = (op) =>
    fromOperationRaw(op, id, subAccounts as SubAccount[]);

  const res: Account = {
    type: "Account",
    id,
    starred: starred || false,
    used: false,
    // filled again below
    seedIdentifier,
    derivationMode,
    index,
    freshAddress,
    freshAddressPath,
    freshAddresses: freshAddresses || [
      // in case user come from an old data that didn't support freshAddresses
      {
        derivationPath: freshAddressPath,
        address: freshAddress,
      },
    ],
    name,
    blockHeight,
    creationDate: new Date(creationDate || Date.now()),
    balance: new BigNumber(balance),
    spendableBalance: new BigNumber(spendableBalance || balance),
    operations: (operations || []).map(convertOperation),
    operationsCount: operationsCount || (operations && operations.length) || 0,
    pendingOperations: (pendingOperations || []).map(convertOperation),
    unit,
    currency,
    feesCurrency,
    lastSyncDate: new Date(lastSyncDate || 0),
    swapHistory: [],
    syncHash,
    balanceHistoryCache: balanceHistoryCache || emptyHistoryCache,
    nfts: nfts?.map((n) => fromNFTRaw(n)),
  };
  res.balanceHistoryCache = generateHistoryFromOperations(res);

  if (typeof used === "undefined") {
    // old account data that didn't had the field yet
    res.used = !isAccountEmpty(res);
  } else {
    res.used = used;
  }

  if (xpub) {
    res.xpub = xpub;
  }

  if (endpointConfig) {
    res.endpointConfig = endpointConfig;
  }

  if (subAccounts) {
    res.subAccounts = subAccounts as SubAccount[];
  }

  switch (res.currency.family) {
    default: {
      const bridge = getAccountBridge(res);
      const assignFromAccountRaw = bridge.assignFromAccountRaw;
      if (assignFromAccountRaw) {
        assignFromAccountRaw(rawAccount, res);
      }
    }
  }

  if (swapHistory) {
    res.swapHistory = swapHistory.map(fromSwapOperationRaw);
  }

  return res;
}
export function toAccountRaw(account: Account): AccountRaw {
  const {
    id,
    seedIdentifier,
    xpub,
    name,
    starred,
    used,
    derivationMode,
    index,
    freshAddress,
    freshAddressPath,
    freshAddresses,
    blockHeight,
    currency,
    feesCurrency,
    creationDate,
    operationsCount,
    operations,
    pendingOperations,
    unit,
    lastSyncDate,
    balance,
    balanceHistoryCache,
    spendableBalance,
    subAccounts,
    endpointConfig,
    swapHistory,
    syncHash,
    nfts,
  } = account;
  const res: AccountRaw = {
    id,
    seedIdentifier,
    name,
    starred,
    used,
    derivationMode,
    index,
    freshAddress,
    freshAddressPath,
    freshAddresses,
    blockHeight,
    syncHash,
    creationDate: creationDate.toISOString(),
    operationsCount,
    operations: (operations || []).map((o) => toOperationRaw(o)),
    pendingOperations: (pendingOperations || []).map((o) => toOperationRaw(o)),
    currencyId: currency.id,
    feesCurrencyId: feesCurrency?.id,
    unitMagnitude: unit.magnitude,
    lastSyncDate: lastSyncDate.toISOString(),
    balance: balance.toFixed(),
    spendableBalance: spendableBalance.toFixed(),
    nfts: nfts?.map((n) => toNFTRaw(n)),
  };

  if (balanceHistoryCache) {
    res.balanceHistoryCache = balanceHistoryCache;
  }

  if (endpointConfig) {
    res.endpointConfig = endpointConfig;
  }

  if (xpub) {
    res.xpub = xpub;
  }

  if (subAccounts) {
    res.subAccounts = subAccounts.map(toSubAccountRaw);
  }

  switch (account.currency.family) {
    default: {
      const bridge = getAccountBridge(account);
      const assignToAccountRaw = bridge.assignToAccountRaw;
      if (assignToAccountRaw) {
        assignToAccountRaw(account, res);
      }
    }
  }

  if (swapHistory) {
    res.swapHistory = swapHistory.map(toSwapOperationRaw);
  }

  return res;
}

export function toNFTRaw({
  id,
  tokenId,
  amount,
  contract,
  standard,
  currencyId,
  metadata,
}: ProtoNFT): ProtoNFTRaw {
  return {
    id,
    tokenId,
    amount: amount.toFixed(),
    contract,
    standard,
    currencyId,
    metadata,
  };
}

export function fromNFTRaw({
  id,
  tokenId,
  amount,
  contract,
  standard,
  currencyId,
  metadata,
}: ProtoNFTRaw): ProtoNFT {
  return {
    id,
    tokenId,
    amount: new BigNumber(amount),
    contract,
    standard,
    currencyId,
    metadata,
  };
}
