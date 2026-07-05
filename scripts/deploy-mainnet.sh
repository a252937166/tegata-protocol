#!/usr/bin/env bash
# TEGATA mainnet proof deployment — one command, run when the deployer wallet
# holds a dust amount of HSK (~0.001 is plenty).
#
#   1. deploys KycGate / TegataRegistry / SettlementAnchor to chainId 177
#   2. verifies all three sources on Blockscout
#   3. anchors the showcase packet's hashes on mainnet:
#      demo attestation -> registerInvoice(sample invoiceHash/riskHash) -> setPacketHash
#   4. writes deployments/hashkey-mainnet.json (served by /api/config -> /proof page)
#
# Usage:  set -a && source .env && set +a && ./scripts/deploy-mainnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RPC="https://mainnet.hsk.xyz"
EXPLORER="https://hashkey.blockscout.com"

: "${ATTESTOR_PRIVATE_KEY:?source .env first}"
: "${ATTESTOR_ADDRESS:?source .env first}"

BAL=$(cast balance "$ATTESTOR_ADDRESS" --rpc-url "$RPC")
echo "deployer $ATTESTOR_ADDRESS balance: $BAL wei"
if [ "$BAL" = "0" ]; then
  echo "ERROR: deployer has no HSK on mainnet — fund it first (gas.zip / exchange / community)"
  exit 1
fi

echo "== 1/4 deploy =="
cd contracts
forge script script/Deploy.s.sol --rpc-url hashkey_mainnet --private-key "$ATTESTOR_PRIVATE_KEY" --broadcast

read -r KYC REG ANCHOR DEPLOY_BLOCK << EOF
$(python3 - << 'PY'
import json
d = json.load(open('broadcast/Deploy.s.sol/177/run-latest.json'))
by = {}
for tx in d['transactions']:
    if tx.get('transactionType') == 'CREATE':
        by[tx['contractName']] = tx['contractAddress']
blocks = [int(r['blockNumber'], 16) if isinstance(r['blockNumber'], str) else r['blockNumber'] for r in d['receipts']]
print(by['KycGate'], by['TegataRegistry'], by['SettlementAnchor'], min(blocks))
PY
)
EOF
echo "KycGate=$KYC TegataRegistry=$REG SettlementAnchor=$ANCHOR block=$DEPLOY_BLOCK"

echo "== 2/4 verify sources =="
for pair in "$KYC src/KycGate.sol:KycGate" "$REG src/TegataRegistry.sol:TegataRegistry" "$ANCHOR src/SettlementAnchor.sol:SettlementAnchor"; do
  addr="${pair%% *}"; name="${pair#* }"
  forge verify-contract "$addr" "$name" --verifier blockscout --verifier-url "$EXPLORER/api" --watch || echo "WARN: verify failed for $name (retry manually)"
done

echo "== 3/4 anchor showcase proof =="
cd "$ROOT"
# NOTE: no empty columns here — bash `read` collapses whitespace-separated
# fields, so an empty middle field would shift everything after it
read -r INVOICE_HASH RISK_HASH FACE << EOF
$(python3 - << 'PY'
import json
p = json.load(open('packets/sample-compliance-packet.json'))
inv = p['invoice']
print(inv['invoiceHash'], inv['riskReportHash'], inv['faceAmountBaseUnits'])
PY
)
EOF
[ -n "$FACE" ] || { echo "ERROR: failed to read sample packet fields"; exit 1; }
# packetHash must be recomputed the canonical way — reuse the server logic
PACKET_HASH=$(cd server && npx tsx -e "
import { readFileSync } from 'node:fs';
import { packetHashOf } from './src/packet.ts';
console.log(packetHashOf(JSON.parse(readFileSync('../packets/sample-compliance-packet.json','utf8'))));
")
DUE=$(( $(date +%s) + 30*86400 ))

cast send "$KYC" "setDemoAttestation(address,bool,string)" "$ATTESTOR_ADDRESS" true "mainnet proof operator" --rpc-url "$RPC" --private-key "$ATTESTOR_PRIVATE_KEY" > /dev/null
REGISTER_TX=$(cast send "$REG" "registerInvoice(bytes32,uint256,uint64,bytes32)" "$INVOICE_HASH" "$FACE" "$DUE" "$RISK_HASH" --rpc-url "$RPC" --private-key "$ATTESTOR_PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
PACKET_TX=$(cast send "$REG" "setPacketHash(uint256,bytes32)" 1 "$PACKET_HASH" --rpc-url "$RPC" --private-key "$ATTESTOR_PRIVATE_KEY" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "registerTx=$REGISTER_TX packetTx=$PACKET_TX"

echo "== 4/4 write deployments/hashkey-mainnet.json =="
cat > deployments/hashkey-mainnet.json << EOF2
{
  "chainId": 177,
  "rpc": "$RPC",
  "explorer": "$EXPLORER",
  "deployBlock": $DEPLOY_BLOCK,
  "contracts": {
    "KycGate": "$KYC",
    "TegataRegistry": "$REG",
    "SettlementAnchor": "$ANCHOR"
  },
  "attestor": "$ATTESTOR_ADDRESS",
  "proof": {
    "sampleInvoiceId": "1",
    "registerTxHash": "$REGISTER_TX",
    "packetAnchorTxHash": "$PACKET_TX",
    "invoiceHash": "$INVOICE_HASH",
    "packetHash": "$PACKET_HASH"
  }
}
EOF2
echo "DONE. Next: rebuild server bundle, redeploy, update README mainnet section."
