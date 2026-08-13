import hre from "hardhat";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const clientAbiDir = join(root, "client", "src", "abi");

async function main() {
  const conn = await hre.network.create();
  const { ethers } = conn;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Escrow = await ethers.getContractFactory("MilestoneEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  const address = await escrow.getAddress();
  const chainId = Number(
    await ethers.provider.send("eth_chainId", []),
  );
  console.log("MilestoneEscrow deployed to:", address);
  console.log("Chain id:", chainId);

  if (!existsSync(clientAbiDir)) mkdirSync(clientAbiDir, { recursive: true });

  const artifactPath = join(
    root,
    "artifacts",
    "contracts",
    "MilestoneEscrow.sol",
    "MilestoneEscrow.json",
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  // ABI + bytecode for the frontend (no logos, no extra metadata).
  writeFileSync(
    join(clientAbiDir, "MilestoneEscrow.json"),
    JSON.stringify(
      { abi: artifact.abi, bytecode: artifact.bytecode, address },
      null,
      2,
    ),
  );

  // Address file the UI reads for the default network (chain id 31337).
  writeFileSync(
    join(clientAbiDir, "address.json"),
    JSON.stringify({ [String(chainId)]: address }, null, 2),
  );

  console.log("Wrote ABI and address to client/src/abi/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
