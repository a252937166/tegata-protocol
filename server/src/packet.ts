import { publicCfg as cfg } from './public-config.ts';
import { canonicalJson, keccakOfJson } from './canonical.ts';
import type { Invoice } from './contracts.ts';
import { STATUS_LABELS } from './contracts.ts';
import type { RiskReport, InvoiceFields } from './ai.ts';

/**
 * The compliance packet: a self-contained, offline-verifiable evidence bundle
 * for one invoice-backed credit event. Everything a relying party (auditor,
 * regulator, counterparty) needs to re-run verification WITHOUT trusting our
 * backend: the HSP triples, the verifier decisions, the pinned trust config,
 * and the chain anchors — each labelled with the chain it lives on.
 */
export interface SettlementLegPacket {
  leg: 'funding' | 'repayment';
  paymentId: `0x${string}`;
  settlementChain: { name: string; chainId: number };
  settlementTxHash?: string;
  mandate: unknown;
  receipt: unknown;
  attestations: unknown[];
  verifierDecision: unknown;
  evidenceHash: `0x${string}`;
  anchor: { chainId: number; txHash: string; contract: string };
  hspExplorerUrl: string;
}

export interface CompliancePacket {
  packetVersion: '1';
  protocol: 'TEGATA Protocol';
  generatedAt: string;
  invoice: {
    registryId: string;
    invoiceHash: `0x${string}`;
    faceAmountBaseUnits: string;
    currency: string;
    dueDate: string;
    status: string;
    riskReportHash: `0x${string}`;
    riskReport: RiskReport;
    parsedFields: InvoiceFields;
  };
  identity: {
    borrower: string;
    borrowerKycMode: string;
    lender: string;
    lenderKycMode: string;
    kycGateContract: string;
  };
  hspSettlement: {
    legs: SettlementLegPacket[];
    pinnedTrustConfig: {
      chainName: string;
      chainId: number;
      coordinatorUrl: string;
      pinnedAdapterAddress: string;
      stablecoin: string;
      pinNote: string;
    };
  };
  chainAnchors: {
    registry: { chainId: number; contract: string; registerTxHash: string };
    settlementAnchors: { chainId: number; contract: string; txHashes: string[] };
  };
  disclaimer: string;
}

/**
 * The packet hash is computed over a DETERMINISTIC projection of the packet.
 * Excluded as display-only provenance:
 *   - `generatedAt` (build timestamp)
 *   - each leg's `settlementTxHash` (known to the original payer run but not
 *     recoverable from a chain-state rebuild; the settlement itself is already
 *     content-addressed by paymentId + the adapter-signed receipt)
 * Everything else — triples, decisions, hashes, anchors — is content-addressed
 * data, so rebuilding from primary sources reproduces the same hash.
 */
export function packetHashOf(packet: CompliancePacket): `0x${string}` {
  const { generatedAt: _volatile, ...rest } = packet;
  const hashable = {
    ...rest,
    hspSettlement: {
      ...rest.hspSettlement,
      legs: rest.hspSettlement.legs.map(({ settlementTxHash: _tx, ...leg }) => leg),
    },
  };
  return keccakOfJson(hashable);
}

export function buildPacket(params: {
  invoiceId: bigint;
  invoice: Invoice;
  fields: InvoiceFields;
  risk: RiskReport;
  borrowerKycMode: string;
  lenderKycMode: string;
  registerTxHash: string;
  legs: SettlementLegPacket[];
}): { packet: CompliancePacket; packetHash: `0x${string}`; json: string } {
  const packet: CompliancePacket = {
    packetVersion: '1',
    protocol: 'TEGATA Protocol',
    generatedAt: new Date().toISOString(),
    invoice: {
      registryId: params.invoiceId.toString(),
      invoiceHash: params.invoice.invoiceHash,
      faceAmountBaseUnits: params.invoice.faceAmount.toString(),
      currency: params.fields.currency,
      dueDate: new Date(Number(params.invoice.dueDate) * 1000).toISOString(),
      status: STATUS_LABELS[params.invoice.status] ?? String(params.invoice.status),
      riskReportHash: params.invoice.riskReportHash,
      riskReport: params.risk,
      parsedFields: params.fields,
    },
    identity: {
      borrower: params.invoice.borrower,
      borrowerKycMode: params.borrowerKycMode,
      lender: params.invoice.lender,
      lenderKycMode: params.lenderKycMode,
      kycGateContract: cfg.contracts.KycGate,
    },
    hspSettlement: {
      legs: params.legs,
      pinnedTrustConfig: {
        chainName: cfg.hspChainName,
        chainId: 133,
        coordinatorUrl: cfg.coordinatorUrl,
        pinnedAdapterAddress: cfg.pinnedAdapterAddress,
        stablecoin: cfg.stablecoin,
        pinNote:
          'adapter address pinned out-of-band at integration time (GET /chains once); ' +
          're-fetching it from the party you are trying not to trust defeats the point',
      },
    },
    chainAnchors: {
      registry: {
        chainId: cfg.anchorChainId,
        contract: cfg.contracts.TegataRegistry,
        registerTxHash: params.registerTxHash,
      },
      settlementAnchors: {
        chainId: cfg.anchorChainId,
        contract: cfg.contracts.SettlementAnchor,
        txHashes: params.legs.map((l) => l.anchor.txHash),
      },
    },
    disclaimer:
      'Demo workflow only; not a public offering of securities or financial services. ' +
      'Invoice documents never go on-chain — hashes only.',
  };
  const packetHash = packetHashOf(packet);
  return { packet, packetHash, json: canonicalJson(packet) };
}
