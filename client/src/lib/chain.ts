// Chain Contract — on-chain binding for the MilestoneEscrow contract.
// Uses web3.js v4 with the injected provider when available (MetaMask-style
// wallets) and falls back to a plain HTTP provider for local demo nodes.
import { Web3 } from "web3";
import artifact from "../abi/MilestoneEscrow.json";
import addresses from "../abi/address.json";

export const AGREEMENT_STATE = ["Created", "Funded", "Active", "Released", "Refunded"] as const;
export const MILESTONE_STATE = ["Pending", "Completed", "Approved"] as const;

export type AgreementSummary = {
  title: string;
  description: string;
  client: string;
  freelancer: string;
  total: bigint;
  escrowed: bigint;
  approved: bigint;
  milestoneCount: bigint;
  state: bigint;
  disputed: boolean;
};

export type MilestoneView = { title: string; amount: bigint; state: bigint };

/** Pick the best available provider: injected wallet first, local node next. */
export async function getWeb3(): Promise<Web3 | null> {
  if (typeof window !== "undefined" && (window as unknown as { ethereum?: unknown }).ethereum) {
    try {
      return new Web3((window as unknown as { ethereum: unknown }).ethereum as never);
    } catch {
      // fall through to HTTP
    }
  }
  try {
    return new Web3("http://localhost:8545");
  } catch {
    return null;
  }
}

export function contractAddress(chainId: number): string | undefined {
  const map = addresses as Record<string, string>;
  return map[String(chainId)] ?? map["31337"];
}

export class EscrowClient {
  readonly contract;
  constructor(
    web3: Web3,
    address: string,
  ) {
    this.contract = new web3.eth.Contract(artifact.abi as never[], address) as never as import("web3").Contract<never>;
  }

  static async create(chainId: number): Promise<EscrowClient | null> {
    const web3 = await getWeb3();
    if (!web3) return null;
    const address = contractAddress(chainId);
    if (!address) return null;
    return new EscrowClient(web3, address);
  }
}

export function formatEth(wei: bigint): string {
  return `${(Number(wei) / 1e18).toFixed(2)} ETH`;
}

export function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
