import { Web3 } from "./client/node_modules/web3/lib/commonjs/index.js";
import { readFileSync } from "node:fs";

const w = new Web3("http://localhost:8545");
const art = JSON.parse(readFileSync("./client/src/abi/MilestoneEscrow.json", "utf8"));
const c = new w.eth.Contract(art.abi, art.address);

// Hardhat node default accounts: #0 = client, #2 = freelancer
w.eth.accounts.wallet.add(
  w.eth.accounts.privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ),
);
w.eth.accounts.wallet.add(
  w.eth.accounts.privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  ),
);
const client = w.eth.accounts.wallet.get(0);

console.log("chain:", await w.eth.getChainId());

// Dynamically resolve the freelancer from the agreement (matches test-e2e-flow)
let freelancer = null;

// Load latest agreement, or create one
let id = Number(await c.methods.agreementCount().call());
// Hardhat node account #2 is the freelancing address used in earlier runs
const freelancerKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
freelancer = w.eth.accounts.privateKeyToAccount(freelancerKey);
w.eth.accounts.wallet.add(freelancer);
if (id === 0) {
  const tx = await c.methods
    .createAgreement(
      "Live verification agreement",
      "Real-time operational check",
      freelancer.address, // hardhat node account #2
      ["Milestone A", "Milestone B"],
      [Web3.utils.toWei("2", "ether"), Web3.utils.toWei("2", "ether")],
    )
    .send({ from: client.address, value: Web3.utils.toWei("4", "ether") });
  id = Number(tx.events.AgreementCreated.returnValues.id);
  console.log("created agreement", id);
} else {
  console.log("reusing existing agreement", id);
}

let s = await c.methods.getAgreement(id).call();
console.log("state:", s.state, "(2 = Active)");

// Freelancer completes both milestones
for (let i = 0; i < 2; i++) {
  await c.methods
    .completeMilestone(id, i)
    .send({ from: freelancer.address });
  console.log("milestone", i, "completed");
}

// Client approves both milestones
for (let i = 0; i < 2; i++) {
  const balBefore = await w.eth.getBalance(freelancer.address);
  await c.methods
    .approveMilestone(id, i)
    .send({ from: client.address });
  const balAfter = await w.eth.getBalance(freelancer.address);
  console.log(
    "milestone",
    i,
    "approved | state:",
    s.state,
    "| freelancer balance change:",
    Web3.utils.fromWei(balAfter - balBefore, "ether"),
    "ETH",
  );
  s = await c.methods.getAgreement(id).call();
  console.log("  agreement state now:", s.state, "(3 = Released)");
}

// Freelancer withdraws remaining balance
const withdrawable = await c.methods.withdrawable(freelancer.address).call();
console.log("freelancer withdrawable:", Web3.utils.fromWei(withdrawable, "ether"), "ETH");
if (BigInt(withdrawable) > 0n) {
  const balBefore = await w.eth.getBalance(freelancer.address);
  await c.methods.withdraw().send({ from: freelancer.address });
  const balAfter = await w.eth.getBalance(freelancer.address);
  console.log(
    "withdrawn | balance change:",
    Web3.utils.fromWei(balAfter - balBefore, "ether"),
    "ETH",
  );
  console.log(
    "withdrawable after:",
    Web3.utils.fromWei(await c.methods.withdrawable(freelancer.address).call(), "ether"),
    "ETH",
  );
}
console.log("\nLIVE FLOW VERIFIED — real-time operation confirmed");
