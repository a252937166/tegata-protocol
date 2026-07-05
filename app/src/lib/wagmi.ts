import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';

export const hashkeyTestnet = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HashKey Token', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://testnet-explorer.hsk.xyz' } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [hashkeyTestnet],
  connectors: [injected()],
  transports: { [hashkeyTestnet.id]: http() },
});

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerInvoice',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'invoiceHash', type: 'bytes32' },
      { name: 'faceAmount', type: 'uint256' },
      { name: 'dueDate', type: 'uint64' },
      { name: 'riskReportHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
] as const;

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
