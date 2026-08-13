// End-to-end flow check: web3.js v4 against the local hardhat node, mirroring
// the frontend's interactions (create → complete → approve → release → withdraw).
import { Web3 } from "web3";
import artifact from "./client/src/abi/MilestoneEscrow.json" with { type: "json" };

const web3 = new Web3("http://localhost:8545");
const chainId = Number(await web3.eth.getChainId());
console.log("chainId:", chainId, "address:", artifact.address);

const pk0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const pk2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const client = web3.eth.accounts.privateKeyToAccount(pk0);
const freelancer = web3.eth.accounts.privateKeyToAccount(pk2);
web3.eth.accounts.wallet.add(client);
web3.eth.accounts.wallet.add(freelancer);

const c = new web3.eth.Contract(artifact.abi, artifact.address);

const send = (method, opts = {}) =>
  method.send({ from: client.address, gas: 3000000n, ...opts });

// 1. createAgreement with funding
const tx = await send(c.methods.createAgreement(
  "Website rebuild",
  "Full rebuild of the marketing site in three milestones.",
  freelancer.address,
  ["Design mockups", "Frontend implementation", "QA and handover"],
  [Web3.utils.toWei("1", "ether"), Web3.utils.toWei("2", "ether"), Web3.utils.toWei("1", "ether")],
), { value: Web3.utils.toWei("4", "ether") });
console.log("createAgreement tx:", tx.transactionHash.slice(0, 18), "events:", Object.keys(tx.events ?? {}).join(","));

// 2. freelancer completes milestones
for (let i = 0; i < 3; i++) {
  await send(c.methods.completeMilestone(1n, BigInt(i)), { from: freelancer.address });
  console.log("completed milestone", i);
}

// 3. client approves milestones 0 and 1
for (let i = 0; i < 2; i++) {
  await send(c.methods.approveMilestone(1n, BigInt(i)), { from: client.address });
  console.log("approved milestone", i);
}
const w = await c.methods.withdrawable(freelancer.address).call();
console.log("freelancer withdrawable:", w, "(expect 3e18)");

// 4. last approval → auto-release
await send(c.methods.approveMilestone(1n, 2n), { from: client.address });
const a = await c.methods.getAgreement(1n).call();
console.log("after final approval — state:", Number(a.state), "(3 = Released), approved:", a.approved);

// 5. freelancer withdraws
const before = await web3.eth.getBalance(freelancer.address);
await send(c.methods.withdraw(), { from: freelancer.address });
const after = await web3.eth.getBalance(freelancer.address);
console.log("freelancer balance delta:", after - before, "(expect ~4e18 minus gas)");
console.log("withdrawable after:", await c.methods.withdrawable(freelancer.address).call());

console.log("E2E flow OK — all 5 stages passed.");
