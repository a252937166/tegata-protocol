export interface InvoiceFields {
  invoiceNumber: string;
  sellerName: string;
  payerName: string;
  amountBaseUnits: string;
  currency: string;
  issueDate: string;
  termDays: number;
  /** confidence the fields were EXTRACTED correctly — not a credit opinion */
  extractionConfidence?: number;
  /** legacy field name on records underwritten before the rename */
  confidence?: number;
}
export interface VerificationCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}
/** One real run of the shared verification core — the ONLY source of PASS marks. */
export interface VerificationReport {
  invoiceId: string;
  packetHash: `0x${string}`;
  checks: VerificationCheck[];
  passed: number;
  total: number;
  allPass: boolean;
  verifiedAt: string;
  chainId: number;
  blockNumber: string;
}
export interface RiskReport {
  engine: string;
  grade: 'A' | 'B' | 'C';
  discountBps: number;
  rationale: string;
  factors: Record<string, string>;
  assessedAt: string;
}
export interface ApiInvoice {
  id: string;
  borrower: `0x${string}`;
  lender: `0x${string}`;
  invoiceHash: `0x${string}`;
  riskReportHash: `0x${string}`;
  faceAmount: string;
  discountedAmount: string;
  dueDate: string;
  createdAt: string;
  status: 'Registered' | 'Funded' | 'Repaid' | 'Overdue' | 'Cancelled' | 'None';
  fundingPaymentId: `0x${string}`;
  repaymentPaymentId: `0x${string}`;
  packetHash: `0x${string}`;
  fields: InvoiceFields | null;
  risk: RiskReport | null;
  reserved?: boolean;
  reservedBy?: string | null;
}
export interface AppConfig {
  chain: { id: number; name: string; rpc: string; explorer: string; nativeSymbol: string };
  contracts: { KycGate: `0x${string}`; TegataRegistry: `0x${string}`; SettlementAnchor: `0x${string}` };
  stablecoin: { address: `0x${string}`; symbol: string; decimals: number };
  hsp: {
    coordinatorUrl: string;
    chainName: string;
    pinnedAdapterAddress: `0x${string}`;
    pinnedIssuerAddress: `0x${string}`;
  };
  demo: { borrower: `0x${string}` };
  mainnet:
    | { deployed: false; note: string }
    | {
        deployed: true;
        chainId: number;
        explorer: string;
        contracts: { KycGate: string; TegataRegistry: string; SettlementAnchor: string };
        proof: {
          sampleInvoiceId?: string;
          registerTxHash?: string;
          packetAnchorTxHash?: string;
          invoiceHash?: string;
          packetHash?: string;
        } | null;
      };
}
export interface PreparedPayment {
  paymentId: `0x${string}`;
  mandateBody: Record<string, unknown>;
  leg: string;
  to: `0x${string}`;
  amount: string;
  toSign: [
    { id: 'mandate'; method: 'eth_signTypedData_v4'; params: { address: `0x${string}`; typedData: unknown } },
    { id: 'settlement'; method: 'eth_sendTransaction'; params: { tx: { from: string; to: `0x${string}`; data: `0x${string}`; value: string; chainId: number } } },
  ];
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `${method} ${path} -> ${res.status}`);
  return j as T;
}

export const api = {
  config: () => req<AppConfig>('GET', '/api/config'),
  invoices: () => req<{ invoices: ApiInvoice[] }>('GET', '/api/invoices'),
  invoice: (id: string) => req<{ invoice: ApiInvoice }>('GET', `/api/invoices/${id}`),
  kycCheck: (address: string) =>
    req<{ ok: boolean; modeLabel: string }>('GET', `/api/kyc/check?address=${address}`),
  kycAttest: (address: string) => req<{ ok: boolean; modeLabel: string }>('POST', '/api/kyc/attest', { address }),
  faucet: (address: string) => req<{ source: string }>('POST', '/api/faucet', { address }),
  underwrite: (documentText: string) =>
    req<{ fields: InvoiceFields; risk: RiskReport; invoiceHash: `0x${string}`; riskReportHash: `0x${string}` }>(
      'POST',
      '/api/ai/underwrite',
      { documentText },
    ),
  issue: (documentText: string) =>
    req<{
      fields: InvoiceFields;
      risk: RiskReport;
      invoiceHash: `0x${string}`;
      riskReportHash: `0x${string}`;
      registerTx: string;
      invoice: ApiInvoice;
    }>('POST', '/api/issue', { documentText }),
  prepare: (payer: string, invoiceId: string, leg: 'funding' | 'repayment') =>
    req<PreparedPayment>('POST', '/api/hsp/prepare', { payer, invoiceId, leg }),
  submit: (p: {
    invoiceId: string;
    leg: 'funding' | 'repayment';
    paymentId: string;
    mandateBody: Record<string, unknown>;
    mandateSignature: string;
    txHash: string;
  }) =>
    req<{ paymentId: string; status: string; anchorTx: string; hspExplorerUrl: string; packetHash: string; invoice: ApiInvoice }>(
      'POST',
      '/api/hsp/submit',
      p,
    ),
  repay: (invoiceId: string) =>
    req<{ paymentId: string; anchorTx: string; hspExplorerUrl: string; invoice: ApiInvoice }>(
      'POST',
      `/api/repay/${invoiceId}`,
    ),
  packet: (invoiceId: string) => req<{ packet: unknown; packetHash: string }>('GET', `/api/packet/${invoiceId}`),
  verify: (invoiceId: string) => req<VerificationReport>('POST', `/api/verify/${invoiceId}`),
  showcase: () =>
    req<{
      packet: Record<string, never> & {
        invoice: {
          registryId: string;
          invoiceHash: string;
          faceAmountBaseUnits: string;
          currency: string;
          dueDate: string;
          status: string;
          riskReport: RiskReport;
          parsedFields: InvoiceFields;
        };
        identity: { borrower: string; borrowerKycMode: string; lender: string; lenderKycMode: string };
        hspSettlement: {
          legs: {
            leg: string;
            paymentId: string;
            settlementChain: { name: string; chainId: number };
            hspExplorerUrl: string;
            anchor: { chainId: number; txHash: string };
            verifierDecision: { outcomeClass?: string };
          }[];
          pinnedTrustConfig: Record<string, string | number>;
        };
        chainAnchors: {
          registry: { chainId: number; contract: string; registerTxHash: string };
          settlementAnchors: { chainId: number; contract: string; txHashes: string[] };
        };
      };
      invoice: ApiInvoice;
      verification: VerificationReport | null;
      links: Record<string, string>;
    }>('GET', '/api/showcase'),
};
