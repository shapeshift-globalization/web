import { CHAIN_NAMESPACE, type ChainId } from '@shapeshiftoss/caip'
import type {
  ContractInteraction,
  evm,
  EvmChainAdapter,
  EvmChainId,
  SignTx,
} from '@shapeshiftoss/chain-adapters'
import { evmChainIds } from '@shapeshiftoss/chain-adapters'
import type { HDWallet } from '@shapeshiftoss/hdwallet-core'
import { supportsETH } from '@shapeshiftoss/hdwallet-core'
import type { EvmTransactionExecutionProps, EvmTransactionRequest } from '@shapeshiftoss/swapper'
import type { KnownChainIds } from '@shapeshiftoss/types'
import { TxStatus } from '@shapeshiftoss/unchained-client'
import { getTxStatus } from '@shapeshiftoss/unchained-client/dist/evm'
import { getOrCreateContractByType } from 'contracts/contractManager'
import { ContractType } from 'contracts/types'
import { encodeFunctionData, getAddress } from 'viem'
import { getChainAdapterManager } from 'context/PluginProvider/chainAdapterSingleton'
import { bn, bnOrZero } from 'lib/bignumber/bignumber'

import { getSupportedChainIdsByChainNamespace } from '.'

type GetApproveContractDataArgs = {
  approvalAmountCryptoBaseUnit: string
  to: string
  spender: string
  chainId: ChainId
}

type BuildArgs = {
  buildCustomTxInput: evm.BuildCustomTxInput
}

type BroadcastArgs = {
  senderAddress: string
  receiverAddress: string | ContractInteraction
  adapter: EvmChainAdapter
  txToSign: SignTx<EvmChainId>
  wallet: HDWallet
}

type BuildAndBroadcastArgs = BuildArgs &
  Omit<BroadcastArgs, 'senderAddress' | 'txToSign' | 'wallet'>

type CreateBuildCustomTxInputArgs = {
  accountNumber: number
  adapter: EvmChainAdapter
  to: string
  data: string
  value: string
  wallet: HDWallet
}

type CreateBuildCustomApiTxInputArgs = {
  accountNumber: number
  adapter: EvmChainAdapter
  from: string
  to: string
  data: string
  value: string
  supportsEIP1559: boolean
}

type GetErc20AllowanceArgs = {
  address: string
  from: string
  spender: string
  chainId: ChainId
}

type GetFeesCommonArgs = {
  adapter: EvmChainAdapter
  data: string
  to: string
  value: string
}

type GetFeesArgs = GetFeesCommonArgs & {
  from: string
  supportsEIP1559: boolean
}

type GetFeesWithWalletArgs = GetFeesCommonArgs & {
  accountNumber: number
  wallet: HDWallet
}

export type Fees = evm.Fees & {
  gasLimit: string
  networkFeeCryptoBaseUnit: string
}

export const getFeesWithWallet = async (args: GetFeesWithWalletArgs): Promise<Fees> => {
  const { accountNumber, adapter, wallet, ...rest } = args

  const from = await adapter.getAddress({ accountNumber, wallet })
  const supportsEIP1559 = supportsETH(wallet) && (await wallet.ethSupportsEIP1559())

  return getFees({ ...rest, adapter, from, supportsEIP1559 })
}

export const getFees = async (args: GetFeesArgs): Promise<Fees> => {
  const { adapter, data, to, value, from, supportsEIP1559 } = args

  const {
    average: { chainSpecific: feeData },
  } = await adapter.getFeeData({ to, value, chainSpecific: { from, data } })

  const networkFeeCryptoBaseUnit = calcNetworkFeeCryptoBaseUnit({
    ...feeData,
    supportsEIP1559,
  })

  const { gasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas } = feeData

  if (supportsEIP1559 && maxFeePerGas && maxPriorityFeePerGas) {
    return { networkFeeCryptoBaseUnit, gasLimit, maxFeePerGas, maxPriorityFeePerGas }
  }

  return { networkFeeCryptoBaseUnit, gasLimit, gasPrice }
}

type CalcNetworkFeeCryptoBaseUnitArgs = evm.FeeData & {
  supportsEIP1559: boolean
}

export const calcNetworkFeeCryptoBaseUnit = (args: CalcNetworkFeeCryptoBaseUnitArgs) => {
  const {
    supportsEIP1559,
    gasLimit,
    gasPrice,
    l1GasLimit,
    l1GasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
  } = args

  // optimism l1 fee if exists or 0
  const l1Fee = bnOrZero(l1GasPrice).times(bnOrZero(l1GasLimit))

  // eip1559 fees
  if (supportsEIP1559 && maxFeePerGas && maxPriorityFeePerGas) {
    return bn(gasLimit).times(maxFeePerGas).plus(l1Fee).toString()
  }

  // legacy fees
  return bn(gasLimit).times(gasPrice).plus(l1Fee).toString()
}

export const createBuildCustomTxInput = async (
  args: CreateBuildCustomTxInputArgs,
): Promise<evm.BuildCustomTxInput> => {
  const fees = await getFeesWithWallet(args)
  return { ...args, ...fees }
}

export const createBuildCustomApiTxInput = async (
  args: CreateBuildCustomApiTxInputArgs,
): Promise<evm.BuildCustomApiTxInput> => {
  const { accountNumber, from, supportsEIP1559, ...rest } = args
  const fees = await getFees({ ...rest, from, supportsEIP1559 })
  return { ...args, ...fees }
}

export const buildAndBroadcast = async ({
  adapter,
  buildCustomTxInput,
  receiverAddress,
}: BuildAndBroadcastArgs) => {
  const senderAddress = await adapter.getAddress(buildCustomTxInput)
  const { txToSign } = await adapter.buildCustomTx(buildCustomTxInput)
  return signAndBroadcast({
    adapter,
    txToSign,
    wallet: buildCustomTxInput.wallet,
    senderAddress,
    receiverAddress,
  })
}

export const signAndBroadcast = async ({
  adapter,
  txToSign,
  wallet,
  senderAddress,
  receiverAddress,
}: BroadcastArgs) => {
  if (!wallet) throw new Error('Wallet is required to broadcast EVM Txs')

  if (wallet.supportsOfflineSigning()) {
    const signedTx = await adapter.signTransaction({ txToSign, wallet })
    const txid = await adapter.broadcastTransaction({
      senderAddress,
      receiverAddress,
      hex: signedTx,
    })
    return txid
  }

  if (wallet.supportsBroadcast() && adapter.signAndBroadcastTransaction) {
    // note that txToSign.to is often a contract address and not the actual receiver
    // TODO: do we want to validate contract addresses too?
    const txid = await adapter.signAndBroadcastTransaction({
      senderAddress,
      receiverAddress,
      signTxInput: { txToSign, wallet },
    })
    return txid
  }

  throw new Error('buildAndBroadcast: no broadcast support')
}

export const getApproveContractData = ({
  approvalAmountCryptoBaseUnit,
  to,
  spender,
  chainId,
}: GetApproveContractDataArgs): string => {
  const address = getAddress(to)
  const contract = getOrCreateContractByType({
    address,
    type: ContractType.ERC20,
    chainId,
  })
  const data = encodeFunctionData({
    abi: contract.abi,
    functionName: 'approve',
    args: [getAddress(spender), BigInt(approvalAmountCryptoBaseUnit)],
  })
  return data
}

export const getErc20Allowance = async ({
  address,
  from,
  spender,
  chainId,
}: GetErc20AllowanceArgs): Promise<string> => {
  const contract = getOrCreateContractByType({
    address,
    type: ContractType.ERC20,
    chainId,
  })
  const allowance = await contract.read.allowance([getAddress(from), getAddress(spender)])
  // TODO(gomes): fix types
  return allowance.toString()
}

export const isEvmChainAdapter = (chainAdapter: unknown): chainAdapter is EvmChainAdapter => {
  return evmChainIds.includes((chainAdapter as EvmChainAdapter).getChainId() as EvmChainId)
}

export const assertGetEvmChainAdapter = (chainId: ChainId | KnownChainIds): EvmChainAdapter => {
  const chainAdapterManager = getChainAdapterManager()
  const adapter = chainAdapterManager.get(chainId)

  if (!isEvmChainAdapter(adapter)) {
    throw Error('invalid chain adapter')
  }

  return adapter
}

export const executeEvmTransaction = (
  txToSign: EvmTransactionRequest,
  callbacks: EvmTransactionExecutionProps,
) => {
  return callbacks.signAndBroadcastTransaction(txToSign)
}

export const createDefaultStatusResponse = (buyTxHash?: string) => ({
  status: TxStatus.Unknown,
  buyTxHash,
  message: undefined,
})

export const checkEvmSwapStatus = async ({
  txHash,
  chainId,
}: {
  txHash: string
  chainId: ChainId
}): Promise<{
  status: TxStatus
  buyTxHash: string | undefined
  message: string | undefined
}> => {
  try {
    const adapter = assertGetEvmChainAdapter(chainId)
    const tx = await adapter.httpProvider.getTransaction({ txid: txHash })
    const status = getTxStatus(tx)

    return {
      status,
      buyTxHash: txHash,
      message: undefined,
    }
  } catch (e) {
    console.error(e)
    return createDefaultStatusResponse(txHash)
  }
}

export const getSupportedEvmChainIds = () => {
  return getSupportedChainIdsByChainNamespace()[CHAIN_NAMESPACE.Evm]
}
