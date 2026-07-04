import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { cfg } from './config.ts';
import KycGateAbi from './abi/KycGate.json' with { type: 'json' };
import TegataRegistryAbi from './abi/TegataRegistry.json' with { type: 'json' };
import SettlementAnchorAbi from './abi/SettlementAnchor.json' with { type: 'json' };

export { KycGateAbi, TegataRegistryAbi, SettlementAnchorAbi };

export const anchorChain = defineChain({
  id: cfg.anchorChainId,
  name: cfg.anchorChainId === 177 ? 'HashKey Chain' : 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HashKey Token', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: [cfg.anchorRpc] } },
  blockExplorers: { default: { name: 'Blockscout', url: cfg.anchorExplorer } },
});

export const publicClient = createPublicClient({ chain: anchorChain, transport: http() });

export function walletFor(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    client: createWalletClient({ account, chain: anchorChain, transport: http() }),
  };
}

export enum InvoiceStatus {
  None,
  Registered,
  Funded,
  Repaid,
  Overdue,
  Cancelled,
}
export const STATUS_LABELS = ['None', 'Registered', 'Funded', 'Repaid', 'Overdue', 'Cancelled'] as const;

export interface Invoice {
  borrower: Address;
  lender: Address;
  invoiceHash: `0x${string}`;
  riskReportHash: `0x${string}`;
  faceAmount: bigint;
  discountedAmount: bigint;
  dueDate: bigint;
  createdAt: bigint;
  status: InvoiceStatus;
  fundingPaymentId: `0x${string}`;
  repaymentPaymentId: `0x${string}`;
  packetHash: `0x${string}`;
}

export async function getInvoice(id: bigint): Promise<Invoice> {
  return (await publicClient.readContract({
    address: cfg.contracts.TegataRegistry,
    abi: TegataRegistryAbi,
    functionName: 'getInvoice',
    args: [id],
  })) as unknown as Invoice;
}

export async function nextInvoiceId(): Promise<bigint> {
  return (await publicClient.readContract({
    address: cfg.contracts.TegataRegistry,
    abi: TegataRegistryAbi,
    functionName: 'nextId',
  })) as bigint;
}

export async function checkKyc(subject: Address) {
  const [ok, mode, level] = (await publicClient.readContract({
    address: cfg.contracts.KycGate,
    abi: KycGateAbi,
    functionName: 'checkKyc',
    args: [subject],
  })) as [boolean, number, number];
  return { ok, mode, level, modeLabel: ['none', 'official-sbt', 'demo-attestor'][mode] };
}

export async function registerInvoice(
  borrowerKey: `0x${string}`,
  args: { invoiceHash: `0x${string}`; faceAmount: bigint; dueDate: bigint; riskReportHash: `0x${string}` },
) {
  const { client, account } = walletFor(borrowerKey);
  const hash = await client.writeContract({
    address: cfg.contracts.TegataRegistry,
    abi: TegataRegistryAbi,
    functionName: 'registerInvoice',
    args: [args.invoiceHash, args.faceAmount, args.dueDate, args.riskReportHash],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi: TegataRegistryAbi, logs: receipt.logs, eventName: 'InvoiceRegistered' });
  const id = (logs[0]?.args as { id?: bigint } | undefined)?.id;
  if (id === undefined) throw new Error('InvoiceRegistered event missing');
  return { id, txHash: hash };
}

export interface SettlementEvidence {
  invoiceId: bigint;
  leg: 0 | 1; // 0 = Funding, 1 = Repayment
  paymentId: `0x${string}`;
  accepted: boolean;
  evidenceHash: `0x${string}`;
  settlementChainId: number;
  payer: Address;
  payee: Address;
  amount: bigint;
  verifiedAt: bigint;
}

export async function anchorSettlement(ev: SettlementEvidence, signature: `0x${string}`) {
  const { client, account } = walletFor(cfg.attestorKey);
  const hash = await client.writeContract({
    address: cfg.contracts.SettlementAnchor,
    abi: SettlementAnchorAbi,
    functionName: 'anchorSettlement',
    args: [ev, signature],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function setPacketHash(invoiceId: bigint, packetHash: `0x${string}`) {
  const { client, account } = walletFor(cfg.attestorKey); // registry owner == deployer == attestor wallet
  const hash = await client.writeContract({
    address: cfg.contracts.TegataRegistry,
    abi: TegataRegistryAbi,
    functionName: 'setPacketHash',
    args: [invoiceId, packetHash],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function setDemoAttestation(subject: Address, approved: boolean, note: string) {
  const { client, account } = walletFor(cfg.attestorKey);
  const hash = await client.writeContract({
    address: cfg.contracts.KycGate,
    abi: KycGateAbi,
    functionName: 'setDemoAttestation',
    args: [subject, approved, note],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
