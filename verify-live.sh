#!/bin/bash
# Live verification of the Chain Contract system
set -e
cd /home/ubuntu/chaincontract

{
echo "=== 1. Hardhat node status (listening on 8545) ==="
ss -tlnp 2>/dev/null | grep -c 8545 || echo "NOT LISTENING"

echo
echo "=== 2. Chain state: block number + chain id ==="
node -e "
import('./client/node_modules/web3/lib/commonjs/index.js').then(async ({Web3}) => {
  const w = new Web3('http://localhost:8545');
  console.log('chainId:', await w.eth.getChainId());
  console.log('blockNumber:', Number(await w.eth.getBlockNumber()));
  const art = JSON.parse(require('fs').readFileSync('./client/src/abi/MilestoneEscrow.json','utf8'));
  console.log('contract address:', art.address);
  const code = await w.eth.getCode(art.address);
  console.log('contract deployed:', code.length > 2 ? 'YES (' + code.length + ' bytes)' : 'NO');
  const bal = BigInt(await w.eth.getBalance(art.address));
  console.log('escrow balance:', (bal/10n**18n).toString(), 'ETH');
  const c = new w.eth.Contract(art.abi, art.address);
  console.log('agreementCount:', (await c.methods.agreementCount().call()).toString());
});
" 2>/dev/null

echo
echo "=== 3. Contract test suite ==="
npx hardhat test 2>&1 | tail -1

echo
echo "=== 4. Live end-to-end transaction flow ==="
node test-e2e-flow.mjs 2>/dev/null | grep -v trace | tail -10
} > /tmp/live-verify.log 2>&1
cat /tmp/live-verify.log
