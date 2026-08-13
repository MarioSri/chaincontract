// Chain Contract — "Ledger Ink" UI
// Paper background, ink text, copper accent, mint approvals, mono ledger rows.
// Every on-chain value renders in IBM Plex Mono like a ledger line.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Web3 } from "web3";
import artifact from "./abi/MilestoneEscrow.json";
import addresses from "./abi/address.json";
import {
  AGREEMENT_STATE,
  EscrowClient,
  MILESTONE_STATE,
  formatEth,
  short,
  type AgreementSummary,
  type MilestoneView,
} from "./lib/chain";

type Account = { address: string; role: "client" | "freelancer" };

type LogEntry = { id: number; text: string; kind: "info" | "ok" | "err" };

const KNOWN_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
];

const PRIVATE_KEY_NAMES: Record<string, string> = {
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266": "Client (acct #0)",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": "Client (acct #1)",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": "Freelancer (acct #2)",
};

export default function App() {
  const [web3, setWeb3] = useState<Web3 | null>(null);
  const [chainId, setChainId] = useState<number>(31337);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [escrow, setEscrow] = useState<EscrowClient | null>(null);
  const [agreementId, setAgreementId] = useState<string>("1");
  const [summary, setSummary] = useState<AgreementSummary | null>(null);
  const [milestones, setMilestones] = useState<MilestoneView[]>([]);
  const [withdrawable, setWithdrawable] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceOfFreelancer, setBalanceOfFreelancer] = useState<bigint>(0n);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const logId = useRef(0);

  const address = useMemo(() => {
    const map = addresses as Record<string, string>;
    return map[String(chainId)] ?? map["31337"];
  }, [chainId]);

  const log = useCallback((text: string, kind: LogEntry["kind"] = "info") => {
    logId.current += 1;
    setLogs((prev) => [{ id: logId.current, text, kind }, ...prev].slice(0, 50));
  }, []);

  // Connect on mount: inject wallet if present, else local hardhat node.
  useEffect(() => {
    (async () => {
      const w = await getAnyWeb3();
      if (!w) {
        log("No provider reachable. Start `npx hardhat node` or connect a wallet.", "err");
        return;
      }
      setWeb3(w);
      try {
        const cid = Number(await w.eth.getChainId());
        setChainId(cid);
      } catch {
        setChainId(31337);
      }
      try {
        const accts = await w.eth.getAccounts();
        setAccounts(accts);
        if (accts.length > 0) setSelected(accts[0]);
      } catch (e) {
        log(`getAccounts failed (${e}), import a key below to demo.`, "err");
      }
    })();
  }, [log]);

  // Build the contract binding whenever web3/selected/address changes.
  useEffect(() => {
    if (!web3 || !address) return;
    setEscrow(new EscrowClient(web3, address));
    log(`Bound MilestoneEscrow @ ${short(address)} on chain ${chainId}`);
  }, [web3, address, chainId, log]);

  const contract = useMemo(() => {
    if (!web3 || !address) return null;
    return new web3.eth.Contract(artifact.abi as never[], address) as unknown as {
      methods: Record<string, (...args: never[]) => { call: () => Promise<unknown>; send: (opts: never) => Promise<unknown> }>;
    };
  }, [web3, address]);

  const loadAgreement = useCallback(async () => {
    if (!contract || !agreementId) return;
    try {
      const id = BigInt(agreementId);
      const s = (await contract.methods.getAgreement(id).call()) as unknown as AgreementSummary;
      const ms: MilestoneView[] = [];
      for (let i = 0; i < Number(s.milestoneCount); i++) {
        const m = (await contract.methods.getMilestone(id, BigInt(i)).call()) as unknown as MilestoneView;
        ms.push(m);
      }
      setSummary(s);
      setMilestones(ms);
      const w = await contract.methods.withdrawable(selected).call();
      setWithdrawable(BigInt(w as string));
      const bal = await web3!.eth.getBalance(selected);
      setBalance(BigInt(bal as string));
      const bf = await contract.methods.withdrawable(s.freelancer).call();
      setBalanceOfFreelancer(BigInt(bf as string));
    } catch (e) {
      log(`Agreement ${agreementId} not found or unreadable: ${e}`, "err");
    }
  }, [contract, agreementId, selected, web3, log]);

  useEffect(() => {
    loadAgreement();
  }, [loadAgreement]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      if (pending) return;
      setPending(label);
      try {
        await fn();
        log(`${label} — confirmed on chain`, "ok");
        await loadAgreement();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`${label} failed: ${msg.slice(0, 200)}`, "err");
      } finally {
        setPending(null);
      }
    },
    [pending, log, loadAgreement],
  );

  const isClient = summary?.client.toLowerCase() === selected.toLowerCase();
  const isFreelancer = summary?.freelancer.toLowerCase() === selected.toLowerCase();
  const stateName = summary ? AGREEMENT_STATE[Number(summary.state)] ?? `#${summary.state}` : "";
  const disputed = summary?.disputed;

  return (
    <div className="min-h-full bg-paper text-ink">
      <header className="border-b border-line bg-paper-2">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              Chain Contract<span className="text-copper">.</span>
            </h1>
            <p className="text-xs text-ink-soft">
              Milestone escrow, settled on chain. No intermediary. No opaque state.
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="rounded border border-line bg-white px-2 py-1">
              chain {chainId}
            </span>
            <span className="rounded border border-line bg-white px-2 py-1">
              {address ? short(address) : "—"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-6 md:grid-cols-[1fr_300px]">
        <section className="space-y-4">
          {/* Account selector */}
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Act as
            </h2>
            <div className="flex flex-wrap gap-2">
              {accounts.length > 0 ? (
                accounts.map((a) => (
                  <button
                    key={a}
                    onClick={() => setSelected(a)}
                    className={`rounded border px-3 py-1.5 font-mono text-xs transition-colors ${
                      selected === a
                        ? "border-copper-strong bg-copper text-white"
                        : "border-line bg-paper hover:border-copper"
                    }`}
                  >
                    {PRIVATE_KEY_NAMES[a] ?? short(a)}
                  </button>
                ))
              ) : (
                <ImportKeyButton
                  web3={web3}
                  onImported={(addr) => {
                    setAccounts((prev) => [...prev, addr]);
                    setSelected(addr);
                  }}
                />
              )}
            </div>
          </div>

          {/* Agreement viewer */}
          <div className="rounded-lg border border-line bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={agreementId}
                onChange={(e) => setAgreementId(e.target.value)}
                className="w-20 rounded border border-line bg-paper px-2 py-1 font-mono text-sm"
                placeholder="id"
              />
              <button
                onClick={() => run("Reload agreement", loadAgreement)}
                className="rounded border border-copper bg-copper px-3 py-1 text-sm text-white transition-transform active:scale-[0.97]"
              >
                Load
              </button>
              {stateName && (
                <span
                  className={`rounded px-2 py-1 font-mono text-xs ${
                    stateName === "Released"
                      ? "bg-mint/20 text-ink"
                      : stateName === "Refunded"
                        ? "bg-amber-warn/20 text-ink"
                        : "bg-paper-2 text-ink"
                  }`}
                >
                  {stateName}
                  {disputed && " · DISPUTED"}
                </span>
              )}
            </div>

            {!summary && contract && (
              <div className="space-y-4">
                <p className="text-sm text-ink-soft">
                  No agreement loaded. Create a demo agreement below — the client
                  funds the full escrow in the same transaction.
                </p>
                <div className="flex flex-wrap gap-2">
                  {accounts.length > 0 && (
                    <ActionBtn
                      label="Create demo agreement (4 ETH escrow, 3 milestones)"
                      primary
                      disabled={!!pending}
                      onClick={() =>
                        run("createAgreement", async () => {
                          const tx = (await contract.methods
                            .createAgreement(
                              "Website rebuild",
                              "Full rebuild of the marketing site in three milestones.",
                              accounts[2] ?? accounts[0],
                              ["Design mockups", "Frontend implementation", "QA and handover"],
                              [
                                Web3.utils.toWei("1", "ether"),
                                Web3.utils.toWei("2", "ether"),
                                Web3.utils.toWei("1", "ether"),
                              ],
                            )
                            .send({
                              from: selected,
                              value: Web3.utils.toWei("4", "ether"),
                            })) as unknown as {
                            events?: {
                              AgreementCreated?: { returnValues: { id: string } };
                            };
                          };
                          const created =
                            tx.events?.AgreementCreated?.returnValues?.id;
                          if (created) {
                            setAgreementId(created);
                          } else {
                            await loadAgreement();
                            setAgreementId(
                              String(Number(agreementId) + 1),
                            );
                          }
                        })
                      }
                    />
                  )}
                </div>
              </div>
            )}
            {summary ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">{summary.title}</h3>
                  <p className="text-sm text-ink-soft">{summary.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
                  <LedgerCell label="Client" value={short(summary.client)} mono />
                  <LedgerCell label="Freelancer" value={short(summary.freelancer)} mono />
                  <LedgerCell label="Total" value={formatEth(summary.total)} mono />
                  <LedgerCell label="Escrowed" value={formatEth(summary.escrowed)} mono />
                  <LedgerCell label="Approved" value={formatEth(summary.approved)} mono />
                  <LedgerCell label="Milestones" value={String(summary.milestoneCount)} />
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
                    Milestones
                  </h4>
                  <ul className="divide-y divide-line border border-line">
                    {milestones.map((m, i) => (
                      <li key={i} className="flex items-center justify-between px-3 py-2">
                        <span className="text-sm">
                          <span className="mr-2 font-mono text-xs text-ink-soft">{i + 1}.</span>
                          {m.title}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs">{formatEth(m.amount)}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              m.state === 2n
                                ? "bg-mint/20 text-ink"
                                : m.state === 1n
                                  ? "bg-amber-warn/20 text-ink"
                                  : "bg-paper-2 text-ink-soft"
                            }`}
                          >
                            {MILESTONE_STATE[Number(m.state)]}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  {isClient && summary.state === 2n && (
                    <ActionBtn
                      label={`Create agreement (demo preset)`}
                      disabled={!!pending}
                      onClick={() =>
                        run("createAgreement", async () => {
                          // preset: 3 milestones funded in one tx
                          const tx = (await contract.methods
                            .createAgreement(
                              "Website rebuild",
                              "Full rebuild of the marketing site in three milestones.",
                              isFreelancer ? selected : accounts[2] ?? selected,
                              ["Design mockups", "Frontend implementation", "QA and handover"],
                              [Web3.utils.toWei("1", "ether"), Web3.utils.toWei("2", "ether"), Web3.utils.toWei("1", "ether")],
                            )
                            .send({
                              from: selected,
                              value: Web3.utils.toWei("4", "ether"),
                            })) as unknown as { events?: Record<string, unknown> };
                          const e = tx.events as never;
                          const created = (e as { AgreementCreated?: { returnValues: { id: string } } })?.AgreementCreated?.returnValues?.id;
                          if (created) setAgreementId(created);
                        })
                      }
                    />
                  )}
                  {isClient && (summary.state === 0n || summary.state === 1n) && summary.escrowed < summary.total && (
                    <ActionBtn
                      label={`Fund escrow ${formatEth(summary.total - summary.escrowed)}`}
                      disabled={!!pending}
                      onClick={() =>
                        run("fundAgreement", () =>
                          contract.methods
                            .fundAgreement(agreementId)
                            .send({ from: selected, value: String(summary.total - summary.escrowed) }),
                        )
                      }
                    />
                  )}
                  {isFreelancer && summary.state === 2n && (
                    <>
                      {milestones.map(
                        (m, i) =>
                          m.state === 0n && (
                            <ActionBtn
                              key={i}
                              label={`Complete #${i + 1}`}
                              disabled={!!pending}
                              onClick={() =>
                                run(`completeMilestone #${i + 1}`, () =>
                                  contract.methods
                                    .completeMilestone(agreementId, BigInt(i))
                                    .send({ from: selected }),
                                )
                              }
                            />
                          ),
                      )}
                    </>
                  )}
                  {isClient && summary.state === 2n && (
                    <>
                      {milestones.map(
                        (m, i) =>
                          m.state === 1n && (
                            <ActionBtn
                              key={i}
                              label={`Approve #${i + 1}`}
                              primary
                              disabled={!!pending}
                              onClick={() =>
                                run(`approveMilestone #${i + 1}`, () =>
                                  contract.methods
                                    .approveMilestone(agreementId, BigInt(i))
                                    .send({ from: selected }),
                                )
                              }
                            />
                          ),
                      )}
                      {milestones.map(
                        (m, i) =>
                          m.state === 1n && (
                            <ActionBtn
                              key={`rev-${i}`}
                              label={`Request revision #${i + 1}`}
                              disabled={!!pending}
                              onClick={() =>
                                run(`requestRevision #${i + 1}`, () =>
                                  contract.methods
                                    .requestRevision(agreementId, BigInt(i))
                                    .send({ from: selected }),
                                )
                              }
                            />
                          ),
                      )}
                      <ActionBtn
                        label="Abort (refund)"
                        danger
                        disabled={!!pending || summary.approved > 0n}
                        onClick={() =>
                          run("abort", () =>
                            contract.methods.abort(agreementId).send({ from: selected }),
                          )
                        }
                      />
                      {!disputed && (
                        <ActionBtn
                          label="Raise dispute"
                          danger
                          disabled={!!pending}
                          onClick={() =>
                            run("dispute", () =>
                              contract.methods.dispute(agreementId).send({ from: selected }),
                            )
                          }
                        />
                      )}
                    </>
                  )}
                  {!isFreelancer && !isClient && summary.state === 2n && !disputed && (
                    <ActionBtn
                      label="Raise dispute"
                      danger
                      disabled={!!pending}
                      onClick={() =>
                        run("dispute", () =>
                          contract.methods.dispute(agreementId).send({ from: selected }),
                        )
                      }
                    />
                  )}
                  {withdrawable > 0n && (
                    <ActionBtn
                      label={`Withdraw ${formatEth(withdrawable)}`}
                      primary
                      disabled={!!pending}
                      onClick={() =>
                        run("withdraw", () =>
                          contract.methods.withdraw().send({ from: selected }),
                        )
                      }
                    />
                  )}
                  {isFreelancer && balanceOfFreelancer > 0n && summary.state !== 4n && (
                    <ActionBtn
                      label={`Freelancer withdraw ${formatEth(balanceOfFreelancer)}`}
                      primary
                      disabled={!!pending}
                      onClick={() =>
                        run("withdraw", () =>
                          contract.methods.withdraw().send({ from: summary!.freelancer }),
                        )
                      }
                    />
                  )}
                </div>
                {summary.approved === summary.total && summary.state === 3n && (
                  <p className="text-sm text-mint">
                    Agreement released — all milestones approved, funds unlocked for withdrawal.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-soft">
                Load an agreement to see its ledger. Create one with the button above.
              </p>
            )}
          </div>
        </section>

        {/* Sidebar: balances + event log */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Ledger balances
            </h2>
            <div className="space-y-1 font-mono text-xs">
              <div className="flex justify-between">
                <span>Wallet</span>
                <span>{formatEth(balance)}</span>
              </div>
              <div className="flex justify-between">
                <span>Withdrawable (you)</span>
                <span>{formatEth(withdrawable)}</span>
              </div>
              {summary && isClient && (
                <div className="flex justify-between">
                  <span>Withdrawable (freelancer)</span>
                  <span>{formatEth(balanceOfFreelancer)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Event log
            </h2>
            <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-[11px]">
              {logs.length === 0 && (
                <li className="text-ink-soft">Transactions appear here…</li>
              )}
              {logs.map((l) => (
                <li
                  key={l.id}
                  className={`border-l-2 pl-2 ${
                    l.kind === "ok"
                      ? "border-mint text-ink"
                      : l.kind === "err"
                        ? "border-amber-warn text-ink"
                        : "border-line text-ink-soft"
                  }`}
                >
                  {l.text}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>

      <footer className="border-t border-line py-4 text-center font-mono text-[11px] text-ink-soft">
        MilestoneEscrow · Solidity 0.8.24 · pull-payment pattern · 16 Hardhat tests passing
      </footer>
    </div>
  );
}

function LedgerCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-line bg-paper px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-soft">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  primary,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 text-sm transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "border border-amber-warn bg-amber-warn/10 text-ink"
          : primary
            ? "border border-copper-strong bg-copper text-white"
            : "border border-line bg-paper-2 text-ink hover:border-copper"
      }`}
    >
      {label}
    </button>
  );
}

function ImportKeyButton({
  web3,
  onImported,
}: {
  web3: Web3 | null;
  onImported: (address: string) => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="flex w-full flex-col gap-1">
      <input
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setError("");
        }}
        placeholder="Paste a hardhat-node private key to demo"
        className="rounded border border-line bg-paper px-2 py-1 font-mono text-xs"
      />
      {error && <span className="text-xs text-amber-warn">{error}</span>}
      <button
        onClick={() => {
          if (!web3) return;
          try {
            const acc = web3.eth.accounts.privateKeyToAccount(key as `0x${string}`);
            web3.eth.accounts.wallet.add(acc);
            web3.eth.defaultAccount = acc.address;
            onImported(acc.address);
          } catch {
            setError("Invalid key — use one of the hardhat node accounts.");
          }
        }}
        className="w-fit rounded border border-copper bg-copper px-3 py-1 text-sm text-white transition-transform active:scale-[0.97]"
      >
        Import key
      </button>
      <span className="text-[10px] text-ink-soft">
        Local demo only — never paste real keys into a browser.
      </span>
    </div>
  );
}

async function getAnyWeb3(): Promise<Web3 | null> {
  if (typeof window !== "undefined" && (window as unknown as { ethereum?: unknown }).ethereum) {
    try {
      return new Web3((window as unknown as { ethereum: unknown }).ethereum as never);
    } catch {
      /* fall through */
    }
  }
  try {
    const w = new Web3("http://localhost:8545");
    await w.eth.getChainId();
    return w;
  } catch {
    return null;
  }
}
