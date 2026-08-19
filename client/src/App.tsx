// Chain Contract — "Ledger Ink" UI
// Paper background, ink text, copper accent, mint approvals, mono ledger rows.
// Every on-chain value renders in IBM Plex Mono like a ledger line.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Web3 } from "web3";
import artifact from "./abi/MilestoneEscrow.json";
import addresses from "./abi/address.json";
import {
  AGREEMENT_STATE,
  MILESTONE_STATE,
  formatEth,
  short,
  type AgreementSummary,
  type MilestoneView,
} from "./lib/chain";


type LogEntry = { id: number; text: string; kind: "info" | "ok" | "err" };
type DraftMilestone = { title: string; amount: string };
type AgreementDraft = {
  title: string;
  description: string;
  freelancer: string;
  initialFunding: string;
  milestones: DraftMilestone[];
};

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
  const [agreementId, setAgreementId] = useState<string>("");
  const [summary, setSummary] = useState<AgreementSummary | null>(null);
  const [milestones, setMilestones] = useState<MilestoneView[]>([]);
  const [withdrawable, setWithdrawable] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceOfFreelancer, setBalanceOfFreelancer] = useState<bigint>(0n);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
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
    log(`Bound MilestoneEscrow @ ${short(address)} on chain ${chainId}`);
  }, [web3, address, chainId, log]);

  const contract = useMemo(() => {
    if (!web3 || !address) return null;
    return new web3.eth.Contract(artifact.abi as never[], address) as unknown as {
      methods: Record<string, ((...args: unknown[]) => unknown)>;
    };
  }, [web3, address]);

  const loadAgreement = useCallback(async (requestedId = agreementId) => {
    if (!contract || !selected) return;
    try {
      const bal = await web3!.eth.getBalance(selected);
      setBalance(BigInt(bal as unknown as string));
      if (!requestedId) {
        setSummary(null);
        setMilestones([]);
        setWithdrawable(0n);
        setBalanceOfFreelancer(0n);
        return;
      }
      const id = BigInt(requestedId);
      const countCall = await (contract.methods.agreementCount as unknown as () => {
        call: () => Promise<unknown>;
      })();
      const agreementCount = BigInt((await countCall.call()) as string);
      if (id === 0n || id > agreementCount) {
        setSummary(null);
        setMilestones([]);
        setWithdrawable(0n);
        setBalanceOfFreelancer(0n);
        return;
      }
      const callS = await (contract.methods.getAgreement as unknown as (a0: unknown) => { call: () => Promise<unknown> })(id);
      const s = (await callS.call()) as unknown as AgreementSummary;
      const ms: MilestoneView[] = [];
      for (let i = 0; i < Number(s.milestoneCount); i++) {
        const callM = await (contract.methods.getMilestone as unknown as (a0: unknown, a1: unknown) => { call: () => Promise<unknown> })(id, BigInt(i));
        const m = (await callM.call()) as unknown as MilestoneView;
        ms.push(m);
      }
      setSummary(s);
      setMilestones(ms);
      const callW = await (contract.methods.withdrawable as unknown as (a0: unknown) => { call: () => Promise<unknown> })(selected);
      const w = await callW.call();
      setWithdrawable(BigInt(w as unknown as string));
      const callBf = await (contract.methods.withdrawable as unknown as (a0: unknown) => { call: () => Promise<unknown> })(s.freelancer);
      const bf = await callBf.call();
      setBalanceOfFreelancer(BigInt(bf as unknown as string));
    } catch (e) {
      setSummary(null);
      setMilestones([]);
      setWithdrawable(0n);
      setBalanceOfFreelancer(0n);
      log(`Agreement ${requestedId} could not be read: ${e}`, "err");
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
        const result = await fn();
        log(`${label} — confirmed on chain`, "ok");
        if (typeof result === "string" && /^\d+$/.test(result)) {
          setAgreementId(result);
          await loadAgreement(result);
        } else {
          await loadAgreement();
        }
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

  const createAgreementFromDraft = useCallback(
    (draft: AgreementDraft) => {
      run("createAgreement", async () => {
        if (!contract || !selected) throw new Error("Connect a wallet account before creating an agreement.");
        const amounts = draft.milestones.map((milestone) => Web3.utils.toWei(milestone.amount, "ether"));
        const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
        const initialFunding = BigInt(Web3.utils.toWei(draft.initialFunding, "ether"));
        if (total === 0n || initialFunding === 0n || initialFunding > total) {
          throw new Error("Initial escrow must be greater than zero and cannot exceed the milestone total.");
        }
        const create = contract.methods.createAgreement as unknown as (
          a0: unknown, a1: unknown, a2: unknown, a3: unknown, a4: unknown,
        ) => Promise<{ send: (options: unknown) => Promise<unknown> }>;
        const tx = await create(
          draft.title.trim(),
          draft.description.trim(),
          draft.freelancer.trim(),
          draft.milestones.map((milestone) => milestone.title.trim()),
          amounts,
        );
        await tx.send({ from: selected, value: String(initialFunding) });
        const count = await (contract.methods.agreementCount as unknown as () => {
          call: () => Promise<unknown>;
        })().call();
        setShowCreateForm(false);
        return String(count);
      });
    },
    [contract, run, selected],
  );

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
                onClick={() => loadAgreement()}
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

            {showCreateForm && contract && (
              <AgreementForm
                pending={!!pending}
                onCancel={() => setShowCreateForm(false)}
                onCreate={createAgreementFromDraft}
              />
            )}

            {!summary && contract && (
              <div className="space-y-4">
                <p className="text-sm text-ink-soft">
                  No agreement is selected. Create an agreement with details supplied by
                  you, or enter an existing on-chain agreement ID above.
                </p>
                <div className="flex flex-wrap gap-2">
                  {accounts.length > 0 && (
                    <ActionBtn
                      label="New on-chain agreement"
                      primary
                      disabled={!!pending}
                      onClick={() => setShowCreateForm(true)}
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
                      label="New on-chain agreement"
                      disabled={!!pending}
                      onClick={() => setShowCreateForm(true)}
                    />
                  )}
                  {isClient && (summary.state === 0n || summary.state === 1n) && summary.escrowed < summary.total && (
                    <ActionBtn
                      label={`Fund escrow ${formatEth(summary.total - summary.escrowed)}`}
                      disabled={!!pending}
                      onClick={() =>
                        run("fundAgreement", async () => {
                          const txF = await ((contract ?? { methods: {} } as never).methods.fundAgreement as unknown as (a0: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId);
                          await txF.send({ from: selected, value: String(summary.total - summary.escrowed) });
                        })
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
                                run(`completeMilestone #${i + 1}`, async () => {
                                  const cBase = (contract ?? { methods: {} } as never);
                                  const txC = await (cBase.methods.completeMilestone as unknown as (a0: unknown, a1: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId, BigInt(i));
                                  await txC.send({ from: selected });
                                })
                              }
                            />
                          ),
                      )}
                    </>
                  )}
                  {isClient && summary.state === 2n && !disputed && (
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
                                run(`approveMilestone #${i + 1}`, async () => {
                                  const txP = await ((contract ?? { methods: {} } as never).methods.approveMilestone as unknown as (a0: unknown, a1: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId, BigInt(i));
                                  await txP.send({ from: selected });
                                })
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
                                run(`requestRevision #${i + 1}`, async () => {
                                  const txR = await ((contract ?? { methods: {} } as never).methods.requestRevision as unknown as (a0: unknown, a1: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId, BigInt(i));
                                  await txR.send({ from: selected });
                                })
                              }
                            />
                          ),
                      )}
                      <ActionBtn
                        label="Abort (refund)"
                        danger
                        disabled={!!pending || summary.approved > 0n}
                        onClick={() =>
                          run("abort", async () => {
                            const txA = await (contract!.methods.abort as unknown as (a0: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId);
                          await txA.send({ from: selected });
                          })
                        }
                      />
                      {!disputed && (
                        <ActionBtn
                          label="Raise dispute"
                          danger
                          disabled={!!pending}
                          onClick={() =>
                            run("dispute", async () => {
                              const txD = await (contract!.methods.dispute as unknown as (a0: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId);
                              await txD.send({ from: selected });
                            })
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
                          run("dispute", async () => {
                          const txD = await (contract!.methods.dispute as unknown as (a0: unknown) => Promise<{ send: (o: unknown) => Promise<unknown> }>)(agreementId);
                          await txD.send({ from: selected });
                        })
                      }
                    />
                  )}
                  {withdrawable > 0n && (
                    <ActionBtn
                      label={`Withdraw ${formatEth(withdrawable)}`}
                      primary
                      disabled={!!pending}
                      onClick={() =>
                        run("withdraw", async () => {
                          const txW1 = await (contract!.methods.withdraw as unknown as () => Promise<{ send: (o: unknown) => Promise<unknown> }>)();
                          await txW1.send({ from: selected });
                        })
                      }
                    />
                  )}
                  {isFreelancer && balanceOfFreelancer > 0n && summary.state !== 4n && (
                    <ActionBtn
                      label={`Freelancer withdraw ${formatEth(balanceOfFreelancer)}`}
                      primary
                      disabled={!!pending}
                      onClick={() =>
                        run("withdraw", async () => {
                          const txW2 = await (contract!.methods.withdraw as unknown as () => Promise<{ send: (o: unknown) => Promise<unknown> }>)();
                          await txW2.send({ from: summary!.freelancer });
                        })
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
                Select an on-chain agreement ID or create one using your own agreement data.
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
        Local Hardhat runtime · simulated development ETH · Solidity 0.8.24 · 18 Hardhat tests passing
      </footer>
    </div>
  );
}

function AgreementForm({
  pending,
  onCancel,
  onCreate,
}: {
  pending: boolean;
  onCancel: () => void;
  onCreate: (draft: AgreementDraft) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [freelancer, setFreelancer] = useState("");
  const [initialFunding, setInitialFunding] = useState("");
  const [milestones, setMilestones] = useState<DraftMilestone[]>([{ title: "", amount: "" }]);
  const [error, setError] = useState("");

  const updateMilestone = (index: number, field: keyof DraftMilestone, value: string) => {
    setMilestones((current) => current.map((milestone, i) => (
      i === index ? { ...milestone, [field]: value } : milestone
    )));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedMilestones = milestones.map((milestone) => ({
      title: milestone.title.trim(),
      amount: milestone.amount.trim(),
    }));
    if (!title.trim() || !description.trim() || !freelancer.trim() || !initialFunding.trim()) {
      setError("Enter an agreement title, description, freelancer address, initial escrow amount, and at least one milestone.");
      return;
    }
    if (!Web3.utils.isAddress(freelancer.trim())) {
      setError("Enter a valid freelancer wallet address for the connected network.");
      return;
    }
    if (cleanedMilestones.some((milestone) => !milestone.title || !milestone.amount)) {
      setError("Every milestone requires a title and ETH amount.");
      return;
    }
    try {
      const total = cleanedMilestones.reduce(
        (sum, milestone) => sum + BigInt(Web3.utils.toWei(milestone.amount, "ether")),
        0n,
      );
      const deposit = BigInt(Web3.utils.toWei(initialFunding, "ether"));
      if (total === 0n || deposit === 0n || deposit > total) {
        setError("Initial escrow must be greater than zero and cannot exceed the total milestone amount.");
        return;
      }
    } catch {
      setError("Use valid positive ETH amounts (for example, 0.25 or 1.5).");
      return;
    }
    setError("");
    onCreate({ title, description, freelancer, initialFunding, milestones: cleanedMilestones });
  };

  return (
    <form onSubmit={submit} className="mb-4 space-y-4 border border-copper bg-paper p-4">
      <div>
        <h3 className="font-semibold">Create an on-chain agreement</h3>
        <p className="mt-1 text-xs text-ink-soft">
          Every value below is supplied by you and written to the connected blockchain after confirmation. On this local runtime, accounts and ETH are simulated development data.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          <span>Agreement title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Brand website build" className="w-full rounded border border-line bg-white px-2 py-1.5 text-sm" />
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span>Freelancer wallet address</span>
          <input value={freelancer} onChange={(event) => setFreelancer(event.target.value)} placeholder="0x…" className="w-full rounded border border-line bg-white px-2 py-1.5 font-mono text-sm" />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-medium">
        <span>Description</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the agreed deliverables and acceptance criteria." className="min-h-20 w-full rounded border border-line bg-white px-2 py-1.5 text-sm" />
      </label>
      <label className="block max-w-xs space-y-1 text-xs font-medium">
        <span>Initial escrow funding (ETH)</span>
        <input value={initialFunding} onChange={(event) => setInitialFunding(event.target.value)} inputMode="decimal" placeholder="0.00" className="w-full rounded border border-line bg-white px-2 py-1.5 font-mono text-sm" />
      </label>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Milestones</h4>
          <button type="button" onClick={() => setMilestones((current) => [...current, { title: "", amount: "" }])} className="text-xs font-medium text-copper hover:text-copper-strong">
            Add milestone
          </button>
        </div>
        {milestones.map((milestone, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <input value={milestone.title} onChange={(event) => updateMilestone(index, "title", event.target.value)} placeholder={`Milestone ${index + 1} title`} className="rounded border border-line bg-white px-2 py-1.5 text-sm" />
            <input value={milestone.amount} onChange={(event) => updateMilestone(index, "amount", event.target.value)} inputMode="decimal" placeholder="ETH amount" className="rounded border border-line bg-white px-2 py-1.5 font-mono text-sm" />
            <button type="button" onClick={() => setMilestones((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)} disabled={milestones.length === 1} className="rounded border border-line px-2 py-1 text-xs text-ink-soft disabled:opacity-40">
              Remove
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-amber-warn">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded border border-copper-strong bg-copper px-3 py-1.5 text-sm text-white transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50">
          Create agreement on-chain
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="rounded border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50">
          Cancel
        </button>
      </div>
    </form>
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
        placeholder="Paste a local development private key"
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
            setError("Invalid key — use an account from your local development node.");
          }
        }}
        className="w-fit rounded border border-copper bg-copper px-3 py-1 text-sm text-white transition-transform active:scale-[0.97]"
      >
        Import key
      </button>
      <span className="text-[10px] text-ink-soft">
        Local development only — never paste a real wallet key into a browser.
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
    const rpcUrl = typeof window === "undefined"
      ? "http://localhost:8545"
      : `${window.location.origin}/rpc`;
    const w = new Web3(rpcUrl);
    await w.eth.getChainId();
    return w;
  } catch {
    return null;
  }
}
