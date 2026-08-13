import { expect } from "chai";
import hre from "hardhat";
import { network } from "hardhat";
import { parseEther } from "ethers";

let ethers;
let networkHelpers;

before(async () => {
  const conn = await network.create();
  ethers = conn.ethers;
  networkHelpers = conn.networkHelpers;
});

const TITLES = ["Design mockups", "Frontend implementation", "QA and handover"];
const AMOUNTS = [parseEther("1"), parseEther("2"), parseEther("1")];
const TOTAL = parseEther("4");

async function deployFixture() {
  const [client, freelancer, outsider] = await ethers.getSigners();
  const Escrow = await ethers.getContractFactory("MilestoneEscrow");
  const escrow = await Escrow.deploy();
  const createTx = await escrow
    .connect(client)
    .createAgreement(
      "Website rebuild",
      "Full rebuild of the marketing site",
      freelancer.address,
      TITLES,
      AMOUNTS,
      { value: TOTAL },
    );
  await createTx.wait();
  return { escrow, client, freelancer, outsider, id: 1n };
}

describe("MilestoneEscrow", () => {
  describe("creation", () => {
    it("creates an agreement and emits AgreementCreated", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      const a = await escrow.getAgreement(1n);
      expect(a.client).to.equal(client.address);
      expect(a.freelancer).to.equal(freelancer.address);
      expect(a.total).to.equal(TOTAL);
      expect(a.escrowed).to.equal(TOTAL);
      expect(a.state).to.equal(2n); // Active
      await expect(
        escrow
          .connect(client)
          .createAgreement("B", "b", freelancer.address, TITLES, AMOUNTS, { value: 0n }),
      )
        .to.emit(escrow, "AgreementCreated")
        .withArgs(2n, client.address, freelancer.address, TOTAL);
    });

    it("rejects mismatched milestone titles and amounts", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await expect(
        escrow
          .connect(client)
          .createAgreement("X", "x", freelancer.address, TITLES, [parseEther("1")], { value: 0n }),
      ).to.be.revertedWithCustomError(escrow, "MilestoneMismatch");
    });

    it("rejects zero-amount and empty agreements", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await expect(
        escrow.connect(client).createAgreement("X", "x", freelancer.address, [], [], { value: 0n }),
      ).to.be.revertedWithCustomError(escrow, "EmptyAgreement");
      await expect(
        escrow
          .connect(client)
          .createAgreement("X", "x", freelancer.address, TITLES, [0n, 0n, 0n], { value: 0n }),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("starts unfunded agreements in the Created state until fully funded", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await escrow
        .connect(client)
        .createAgreement("U", "u", freelancer.address, TITLES, AMOUNTS, { value: parseEther("1") });
      expect((await escrow.getAgreement(2n)).state).to.equal(0n); // Created
      await escrow.connect(client).fundAgreement(2n, { value: TOTAL });
      expect((await escrow.getAgreement(2n)).state).to.equal(2n); // Active
    });
  });

  describe("access control", () => {
    it("blocks outsiders and role swaps", async () => {
      const { escrow, outsider, freelancer, client } = await deployFixture();
      await expect(
        escrow.connect(outsider).completeMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "OnlyFreelancer");
      await expect(
        escrow.connect(outsider).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "OnlyClient");
      await expect(
        escrow.connect(client).completeMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "OnlyFreelancer");
      await expect(escrow.connect(freelancer).abort(1n)).to.be.revertedWithCustomError(
        escrow,
        "OnlyClient",
      );
    });
  });

  describe("milestone lifecycle", () => {
    it("runs the happy path: complete -> approve -> auto-release", async () => {
      const { escrow, freelancer, client } = await deployFixture();
      for (let i = 0; i < 3; i++) {
        await expect(escrow.connect(freelancer).completeMilestone(1n, BigInt(i)))
          .to.emit(escrow, "MilestoneCompleted")
          .withArgs(1n, BigInt(i));
      }
      await expect(escrow.connect(client).approveMilestone(1n, 0n))
        .to.emit(escrow, "MilestoneApproved")
        .withArgs(1n, 0n, parseEther("1"));
      await expect(escrow.connect(client).approveMilestone(1n, 1n))
        .to.emit(escrow, "MilestoneApproved")
        .withArgs(1n, 1n, parseEther("2"));
      expect(await escrow.withdrawable(freelancer.address)).to.equal(parseEther("3"));
      expect((await escrow.getAgreement(1n)).state).to.equal(2n); // still Active

      await expect(escrow.connect(client).approveMilestone(1n, 2n))
        .to.emit(escrow, "MilestoneApproved")
        .and.to.emit(escrow, "AgreementReleased")
        .withArgs(1n, TOTAL);
      expect((await escrow.getAgreement(1n)).state).to.equal(3n); // Released
      expect(await escrow.withdrawable(freelancer.address)).to.equal(TOTAL);

      const before = await ethers.provider.getBalance(freelancer.address);
      const tx = await escrow.connect(freelancer).withdraw();
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await ethers.provider.getBalance(freelancer.address);
      expect(after + gas).to.equal(before + TOTAL);
      expect(await escrow.withdrawable(freelancer.address)).to.equal(0n);
    });

    it("rejects approving a pending milestone and double approval", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await expect(
        escrow.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
      await escrow.connect(freelancer).completeMilestone(1n, 0n);
      await escrow.connect(client).approveMilestone(1n, 0n);
      await expect(
        escrow.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("allows the client to request a revision back to pending", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await escrow.connect(freelancer).completeMilestone(1n, 0n);
      await expect(escrow.connect(client).requestRevision(1n, 0n))
        .to.emit(escrow, "MilestoneRevised")
        .withArgs(1n, 0n);
      expect((await escrow.getMilestone(1n, 0n)).state).to.equal(0n); // Pending
      await expect(escrow.connect(freelancer).completeMilestone(1n, 0n)).to.emit(
        escrow,
        "MilestoneCompleted",
      );
    });

    it("blocks actions after full release and rejects out-of-range indexes", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      for (let i = 0n; i < 3n; i++) {
        await escrow.connect(freelancer).completeMilestone(1n, i);
        await escrow.connect(client).approveMilestone(1n, i);
      }
      await expect(
        escrow.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(
        escrow.connect(client).requestRevision(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(
        escrow.connect(freelancer).completeMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
      let threw = false;
      try {
        await escrow.connect(freelancer).completeMilestone(1n, 5n);
      } catch {
        threw = true;
      }
      expect(threw, "out-of-range milestone call must revert").to.be.true;
    });

    it("rejects out-of-range milestone indexes on an active agreement", async () => {
      const { escrow, freelancer } = await deployFixture();
      await expect(
        escrow.connect(freelancer).completeMilestone(1n, 5n),
      ).to.be.revertedWithCustomError(escrow, "MilestoneOutOfRange");
    });
  });

  describe("abort and disputes", () => {
    it("refunds the client on abort before any approval", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      const tx = await escrow.connect(client).abort(1n);
      await tx.wait();
      // Funds stay in the contract under the pull pattern: abort accrues the
      // full escrow to the client's withdrawable balance and withdraw()
      // delivers it, keeping balance math independent of gas timing.
      expect(await escrow.withdrawable(client.address)).to.equal(TOTAL);
      const before = await ethers.provider.getBalance(client.address);
      const wtx = await escrow.connect(client).withdraw();
      const wReceipt = await wtx.wait();
      const wGas = wReceipt.gasUsed * wReceipt.gasPrice;
      const after = await ethers.provider.getBalance(client.address);
      expect(after + wGas).to.equal(before + TOTAL);
      expect((await escrow.getAgreement(1n)).state).to.equal(4n); // Refunded
      await expect(escrow.connect(client).abort(1n)).to.be.revertedWithCustomError(
        escrow,
        "InvalidState",
      );
      expect(await escrow.withdrawable(freelancer.address)).to.equal(0n);
    });

    it("blocks abort once a milestone has been approved", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await escrow.connect(freelancer).completeMilestone(1n, 0n);
      await escrow.connect(client).approveMilestone(1n, 0n);
      await expect(escrow.connect(client).abort(1n)).to.be.revertedWithCustomError(
        escrow,
        "InvalidState",
      );
    });

    it("lets either party raise a dispute once", async () => {
      const { escrow, client, freelancer } = await deployFixture();
      await expect(escrow.connect(client).dispute(1n))
        .to.emit(escrow, "AgreementDisputed")
        .withArgs(1n, client.address);
      await expect(escrow.connect(client).dispute(1n)).to.be.revertedWithCustomError(
        escrow,
        "AlreadyDisputed",
      );
      await expect(
        escrow.connect(client).approveMilestone(1n, 0n),
      ).to.be.revertedWithCustomError(escrow, "InvalidState");
      const outsider = (await ethers.getSigners())[3];
      await expect(
        escrow.connect(outsider).dispute(1n),
      ).to.be.revertedWithCustomError(escrow, "OnlyClientOrFreelancer");
    });
  });

  describe("withdrawals and edge cases", () => {
    it("rejects withdrawing with an empty balance", async () => {
      const { escrow, outsider } = await deployFixture();
      await expect(escrow.connect(outsider).withdraw()).to.be.revertedWithCustomError(
        escrow,
        "NothingToWithdraw",
      );
    });

    it("rejects funding with zero value", async () => {
      const { escrow, client } = await deployFixture();
      await expect(escrow.connect(client).fundAgreement(1n, { value: 0n })).to.be.revertedWithCustomError(
        escrow,
        "ZeroAmount",
      );
    });

    it("blocks non-clients from funding and credits overpayment", async () => {
      const { escrow, outsider } = await deployFixture();
      await expect(
        escrow.connect(outsider).fundAgreement(1n, { value: parseEther("1") }),
      ).to.be.revertedWithCustomError(escrow, "OnlyClient");
      // fundAgreement is client-only, so use a fresh agreement owned by the
      // outsider to exercise overpayment crediting
      const [client, freelancer] = await ethers.getSigners();
      await escrow
        .connect(client)
        .createAgreement("O", "o", freelancer.address, TITLES, AMOUNTS, { value: parseEther("2") });
      const oid = 2n;
      await escrow.connect(client).fundAgreement(oid, { value: TOTAL + parseEther("10") });
      const a = await escrow.getAgreement(oid);
      expect(a.escrowed).to.equal(parseEther("2") + TOTAL + parseEther("10"));
      expect(a.state).to.equal(2n); // Active — fully funded
    });
  });
});
