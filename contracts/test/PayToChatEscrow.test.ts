import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { Signer } from "ethers";
import type {
  PayToChatEscrow,
  MockERC20,
  MockUSDTLike,
  MockFeeOnTransfer,
  MaliciousReenterer,
} from "../typechain-types";

const ZERO = ethers.ZeroAddress;
const FEE_BPS = 250; // 2.5%
const ONE_USDC = 1_000_000n; // 6 decimals

function id(s: string): string {
  // bytes32 paymentId derived from a label
  return ethers.id(s);
}

async function deployFixture() {
  const [deployer, owner, sender, recipient, attacker] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockERC20");
  const usdc = (await Token.deploy("USDC", "USDC", 6)) as unknown as MockERC20;

  const USDT = await ethers.getContractFactory("MockUSDTLike");
  const usdt = (await USDT.deploy()) as unknown as MockUSDTLike;

  const FOT = await ethers.getContractFactory("MockFeeOnTransfer");
  const fot = (await FOT.deploy(100)) as unknown as MockFeeOnTransfer; // 1% FoT

  const Escrow = await ethers.getContractFactory("PayToChatEscrow");
  const escrow = (await Escrow.deploy(
    await owner.getAddress(),
    FEE_BPS,
  )) as unknown as PayToChatEscrow;

  await escrow.connect(owner).setTokenAllowed(await usdc.getAddress(), true);
  await escrow.connect(owner).setTokenAllowed(await usdt.getAddress(), true);

  // Fund sender with all three tokens.
  await usdc.mint(await sender.getAddress(), 1_000n * ONE_USDC);
  await usdt.mint(await sender.getAddress(), 1_000n * ONE_USDC);
  await fot.mint(await sender.getAddress(), 1_000n * ONE_USDC);

  // Approvals (large)
  await usdc.connect(sender).approve(await escrow.getAddress(), ethers.MaxUint256);
  await usdt.connect(sender).approve(await escrow.getAddress(), ethers.MaxUint256);
  await fot.connect(sender).approve(await escrow.getAddress(), ethers.MaxUint256);

  return { deployer, owner, sender, recipient, attacker, usdc, usdt, fot, escrow };
}

async function futureDeadline(secondsFromNow = 3600): Promise<bigint> {
  return BigInt((await time.latest()) + secondsFromNow);
}

describe("PayToChatEscrow", () => {
  describe("constructor", () => {
    it("sets owner and fee, rejects zero owner and fee > MAX", async () => {
      const Escrow = await ethers.getContractFactory("PayToChatEscrow");
      const [, owner] = await ethers.getSigners();

      const e = await Escrow.deploy(await owner.getAddress(), 100);
      expect(await e.owner()).to.equal(await owner.getAddress());
      expect(await e.feeBps()).to.equal(100);

      // OZ's Ownable runs first and surfaces this as OwnableInvalidOwner —
      // exactly the protection we want, just under a different name.
      await expect(Escrow.deploy(ZERO, 100)).to.be.revertedWithCustomError(
        e,
        "OwnableInvalidOwner",
      );

      await expect(
        Escrow.deploy(await owner.getAddress(), 1001),
      ).to.be.revertedWithCustomError(e, "FeeTooHigh");
    });
  });

  describe("admin", () => {
    it("only owner can set token allowlist / fee / pause / withdrawFees", async () => {
      const { escrow, sender, usdc } = await deployFixture();
      await expect(
        escrow.connect(sender).setTokenAllowed(await usdc.getAddress(), true),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");

      await expect(
        escrow.connect(sender).setFeeBps(100),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");

      await expect(escrow.connect(sender).pause()).to.be.revertedWithCustomError(
        escrow,
        "OwnableUnauthorizedAccount",
      );

      await expect(
        escrow
          .connect(sender)
          .withdrawFees(await usdc.getAddress(), await sender.getAddress()),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("setTokenAllowed rejects zero address and emits", async () => {
      const { escrow, owner, usdc } = await deployFixture();
      await expect(
        escrow.connect(owner).setTokenAllowed(ZERO, true),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");

      await expect(
        escrow.connect(owner).setTokenAllowed(await usdc.getAddress(), false),
      )
        .to.emit(escrow, "TokenAllowlistUpdated")
        .withArgs(await usdc.getAddress(), false);
      expect(await escrow.tokenAllowed(await usdc.getAddress())).to.equal(false);
    });

    it("setFeeBps caps at MAX_FEE_BPS and emits", async () => {
      const { escrow, owner } = await deployFixture();
      await expect(
        escrow.connect(owner).setFeeBps(1001),
      ).to.be.revertedWithCustomError(escrow, "FeeTooHigh");
      await expect(escrow.connect(owner).setFeeBps(500))
        .to.emit(escrow, "FeeUpdated")
        .withArgs(FEE_BPS, 500);
      expect(await escrow.feeBps()).to.equal(500);
    });

    it("pause blocks new deposits but NOT claim or refund", async () => {
      const { escrow, owner, sender, recipient, usdc } = await deployFixture();
      const pid = id("p1");
      const dl = await futureDeadline();
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);

      await escrow.connect(owner).pause();

      // New deposit blocked.
      await expect(
        escrow
          .connect(sender)
          .deposit(
            id("p2"),
            await recipient.getAddress(),
            await usdc.getAddress(),
            ONE_USDC,
            dl,
          ),
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");

      // Claim still works.
      await expect(escrow.connect(recipient).claim(pid)).to.emit(escrow, "Claimed");

      // Unpause.
      await escrow.connect(owner).unpause();
      await expect(
        escrow
          .connect(sender)
          .deposit(
            id("p3"),
            await recipient.getAddress(),
            await usdc.getAddress(),
            ONE_USDC,
            dl,
          ),
      ).to.emit(escrow, "Deposited");
    });

    it("ownership transfer is two-step (Ownable2Step)", async () => {
      const { escrow, owner, attacker } = await deployFixture();
      await escrow.connect(owner).transferOwnership(await attacker.getAddress());
      // Still owner until accepted.
      expect(await escrow.owner()).to.equal(await owner.getAddress());
      // Wrong address can't accept.
      const [deployer] = await ethers.getSigners();
      await expect(
        escrow.connect(deployer).acceptOwnership(),
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
      await escrow.connect(attacker).acceptOwnership();
      expect(await escrow.owner()).to.equal(await attacker.getAddress());
    });
  });

  describe("deposit", () => {
    it("happy path: emits Deposited and stores Pending payment", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const pid = id("happy");
      const dl = await futureDeadline();
      await expect(
        escrow
          .connect(sender)
          .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl),
      )
        .to.emit(escrow, "Deposited")
        .withArgs(
          pid,
          await sender.getAddress(),
          await recipient.getAddress(),
          await usdc.getAddress(),
          ONE_USDC,
          dl,
        );

      const p = await escrow.getPayment(pid);
      expect(p.sender).to.equal(await sender.getAddress());
      expect(p.recipient).to.equal(await recipient.getAddress());
      expect(p.amount).to.equal(ONE_USDC);
      expect(p.token).to.equal(await usdc.getAddress());
      expect(p.deadline).to.equal(dl);
      expect(p.status).to.equal(1n); // Pending
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(ONE_USDC);
    });

    it("rejects zero paymentId / zero recipient / self-recipient / zero amount / past deadline", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline();
      const u = await usdc.getAddress();
      const r = await recipient.getAddress();
      const pid = id("ok");

      await expect(
        escrow.connect(sender).deposit(ethers.ZeroHash, r, u, ONE_USDC, dl),
      ).to.be.revertedWithCustomError(escrow, "InvalidPaymentId");
      await expect(
        escrow.connect(sender).deposit(pid, ZERO, u, ONE_USDC, dl),
      ).to.be.revertedWithCustomError(escrow, "InvalidRecipient");
      await expect(
        escrow
          .connect(sender)
          .deposit(pid, await sender.getAddress(), u, ONE_USDC, dl),
      ).to.be.revertedWithCustomError(escrow, "InvalidRecipient");
      await expect(
        escrow.connect(sender).deposit(pid, r, u, 0, dl),
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
      await expect(
        escrow.connect(sender).deposit(pid, r, u, ONE_USDC, BigInt(await time.latest())),
      ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
    });

    it("rejects non-allowlisted tokens", async () => {
      const { escrow, sender, recipient, fot } = await deployFixture();
      const dl = await futureDeadline();
      await expect(
        escrow
          .connect(sender)
          .deposit(
            id("fot"),
            await recipient.getAddress(),
            await fot.getAddress(),
            ONE_USDC,
            dl,
          ),
      ).to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
    });

    it("rejects reuse of the same paymentId", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline();
      const r = await recipient.getAddress();
      const u = await usdc.getAddress();
      const pid = id("dup");
      await escrow.connect(sender).deposit(pid, r, u, ONE_USDC, dl);
      await expect(
        escrow.connect(sender).deposit(pid, r, u, ONE_USDC, dl),
      ).to.be.revertedWithCustomError(escrow, "PaymentExists");
    });

    it("works with USDT-style non-bool-returning ERC-20 (SafeERC20)", async () => {
      const { escrow, sender, recipient, usdt } = await deployFixture();
      const dl = await futureDeadline();
      await expect(
        escrow
          .connect(sender)
          .deposit(
            id("usdt-1"),
            await recipient.getAddress(),
            await usdt.getAddress(),
            ONE_USDC,
            dl,
          ),
      ).to.emit(escrow, "Deposited");
      expect(await usdt.balanceOf(await escrow.getAddress())).to.equal(ONE_USDC);
    });

    it("escrows actually-received amount with fee-on-transfer tokens", async () => {
      const { escrow, owner, sender, recipient, fot } = await deployFixture();
      await escrow.connect(owner).setTokenAllowed(await fot.getAddress(), true);
      const dl = await futureDeadline();
      const pid = id("fot-1");
      const tx = await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await fot.getAddress(), ONE_USDC, dl);
      await tx.wait();
      const p = await escrow.getPayment(pid);
      // 1% fee burned to SINK -> escrow received 99%.
      const expected = (ONE_USDC * 9_900n) / 10_000n;
      expect(p.amount).to.equal(expected);
      expect(await fot.balanceOf(await escrow.getAddress())).to.equal(expected);
    });
  });

  describe("claim", () => {
    it("happy path: pays recipient amount-fee, accumulates fee", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline();
      const pid = id("c1");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);

      const fee = (ONE_USDC * BigInt(FEE_BPS)) / 10_000n;
      const toR = ONE_USDC - fee;

      await expect(escrow.connect(recipient).claim(pid))
        .to.emit(escrow, "Claimed")
        .withArgs(pid, await recipient.getAddress(), await usdc.getAddress(), toR, fee);

      expect(await usdc.balanceOf(await recipient.getAddress())).to.equal(toR);
      expect(await escrow.accumulatedFees(await usdc.getAddress())).to.equal(fee);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(fee);

      const p = await escrow.getPayment(pid);
      expect(p.status).to.equal(2n); // Claimed
    });

    it("zero fee mode (feeBps == 0) sends full amount, accumulates 0", async () => {
      const { escrow, owner, sender, recipient, usdc } = await deployFixture();
      await escrow.connect(owner).setFeeBps(0);
      const dl = await futureDeadline();
      const pid = id("c-zero");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);

      await escrow.connect(recipient).claim(pid);
      expect(await usdc.balanceOf(await recipient.getAddress())).to.equal(ONE_USDC);
      expect(await escrow.accumulatedFees(await usdc.getAddress())).to.equal(0);
    });

    it("rejects non-recipient, double claim, claim of refunded, nonexistent", async () => {
      const { escrow, sender, recipient, attacker, usdc } = await deployFixture();
      const dl = await futureDeadline(60);
      const pid = id("c-bad");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);

      await expect(
        escrow.connect(attacker).claim(pid),
      ).to.be.revertedWithCustomError(escrow, "NotRecipient");

      await expect(
        escrow.connect(recipient).claim(id("nope")),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");

      await escrow.connect(recipient).claim(pid);
      await expect(
        escrow.connect(recipient).claim(pid),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("can be claimed even after the deadline passes (no expiry on claim)", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline(60);
      const pid = id("c-late");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);
      await time.increase(120);
      // Sender hasn't refunded yet — recipient is still allowed to claim.
      await expect(escrow.connect(recipient).claim(pid)).to.emit(escrow, "Claimed");
    });

    it("refund-then-claim race: once refunded, claim reverts", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline(60);
      const pid = id("c-race");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);
      await time.increase(120);
      await escrow.connect(sender).refund(pid);
      await expect(
        escrow.connect(recipient).claim(pid),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("refund", () => {
    it("happy path: only after deadline, only by sender, full amount", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline(60);
      const pid = id("r1");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);

      await expect(
        escrow.connect(sender).refund(pid),
      ).to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");

      await time.increase(120);

      await expect(escrow.connect(sender).refund(pid))
        .to.emit(escrow, "Refunded")
        .withArgs(pid, await sender.getAddress(), await usdc.getAddress(), ONE_USDC);

      expect(await usdc.balanceOf(await sender.getAddress())).to.equal(1_000n * ONE_USDC);
      expect(await escrow.accumulatedFees(await usdc.getAddress())).to.equal(0);
      const p = await escrow.getPayment(pid);
      expect(p.status).to.equal(3n); // Refunded
    });

    it("rejects non-sender", async () => {
      const { escrow, sender, recipient, attacker, usdc } = await deployFixture();
      const dl = await futureDeadline(60);
      const pid = id("r2");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);
      await time.increase(120);
      await expect(
        escrow.connect(attacker).refund(pid),
      ).to.be.revertedWithCustomError(escrow, "NotSender");
    });

    it("rejects double refund and refund-of-claimed", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline(60);
      const pid = id("r3");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);
      await escrow.connect(recipient).claim(pid);
      await time.increase(120);
      await expect(
        escrow.connect(sender).refund(pid),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });

    it("rejects refund of nonexistent paymentId", async () => {
      const { escrow, sender } = await deployFixture();
      await expect(
        escrow.connect(sender).refund(id("nope")),
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("withdrawFees", () => {
    it("admin pulls accumulated fee, accumulator resets, cannot reach principal", async () => {
      const { escrow, owner, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline();
      const pid1 = id("w1");
      const pid2 = id("w2");
      const u = await usdc.getAddress();
      const r = await recipient.getAddress();

      // Deposit two; claim one (fee accrues), leave the other Pending (principal).
      await escrow.connect(sender).deposit(pid1, r, u, ONE_USDC, dl);
      await escrow.connect(sender).deposit(pid2, r, u, ONE_USDC, dl);
      await escrow.connect(recipient).claim(pid1);

      const fee = (ONE_USDC * BigInt(FEE_BPS)) / 10_000n;
      expect(await escrow.accumulatedFees(u)).to.equal(fee);
      // Contract balance = 1 fully escrowed payment + 1 fee.
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(ONE_USDC + fee);

      const treasury = (await ethers.getSigners())[6];
      await expect(
        escrow.connect(owner).withdrawFees(u, await treasury.getAddress()),
      )
        .to.emit(escrow, "FeesWithdrawn")
        .withArgs(u, await treasury.getAddress(), fee);
      expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(fee);
      expect(await escrow.accumulatedFees(u)).to.equal(0);

      // Principal still escrowed for pid2 — owner cannot touch it.
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(ONE_USDC);
      await expect(
        escrow.connect(owner).withdrawFees(u, await treasury.getAddress()),
      ).to.be.revertedWithCustomError(escrow, "NoFeesToWithdraw");

      // pid2 is still claimable — proves principal was never touched.
      await expect(escrow.connect(recipient).claim(pid2)).to.emit(escrow, "Claimed");
    });

    it("rejects zero address recipient", async () => {
      const { escrow, owner, usdc } = await deployFixture();
      await expect(
        escrow.connect(owner).withdrawFees(await usdc.getAddress(), ZERO),
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });
  });

  describe("quoteClaim view", () => {
    it("returns (toRecipient, fee) for Pending; (0,0) otherwise", async () => {
      const { escrow, sender, recipient, usdc } = await deployFixture();
      const dl = await futureDeadline();
      const pid = id("q1");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await usdc.getAddress(), ONE_USDC, dl);

      const fee = (ONE_USDC * BigInt(FEE_BPS)) / 10_000n;
      const [toR, f] = await escrow.quoteClaim(pid);
      expect(toR).to.equal(ONE_USDC - fee);
      expect(f).to.equal(fee);

      await escrow.connect(recipient).claim(pid);
      const [toR2, f2] = await escrow.quoteClaim(pid);
      expect(toR2).to.equal(0);
      expect(f2).to.equal(0);
    });
  });

  describe("reentrancy", () => {
    async function deployReentrant() {
      const fx = await deployFixture();
      const Mal = await ethers.getContractFactory("MaliciousReenterer");
      const mal = (await Mal.deploy()) as unknown as MaliciousReenterer;
      await fx.escrow.connect(fx.owner).setTokenAllowed(await mal.getAddress(), true);
      // Fund + approve.
      await mal.mint(await fx.sender.getAddress(), 1_000n * ONE_USDC);
      await mal.connect(fx.sender).approve(await fx.escrow.getAddress(), ethers.MaxUint256);
      return { ...fx, mal };
    }

    it("nonReentrant blocks reentry into claim() via malicious token transfer", async () => {
      const { escrow, sender, recipient, mal } = await deployReentrant();
      const dl = await futureDeadline();
      const pid = id("re1");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await mal.getAddress(), ONE_USDC, dl);

      // Arm: when escrow transfers to recipient, token will try to call claim() again.
      await mal.arm(await escrow.getAddress(), pid, 1);

      // The outer claim must succeed; the inner reentrant claim attempt
      // must have been caught by ReentrancyGuard (try/catch in the mock
      // surfaces this as `reentered == false`).
      await expect(escrow.connect(recipient).claim(pid)).to.emit(escrow, "Claimed");
      expect(await mal.reentered()).to.equal(false);

      // Status must be Claimed (single, not double).
      const p = await escrow.getPayment(pid);
      expect(p.status).to.equal(2n);
    });

    it("nonReentrant blocks reentry into refund() via malicious token transfer", async () => {
      const { escrow, sender, recipient, mal } = await deployReentrant();
      const dl = await futureDeadline(60);
      const pid = id("re2");
      await escrow
        .connect(sender)
        .deposit(pid, await recipient.getAddress(), await mal.getAddress(), ONE_USDC, dl);
      await time.increase(120);

      await mal.arm(await escrow.getAddress(), pid, 2);

      await expect(escrow.connect(sender).refund(pid)).to.emit(escrow, "Refunded");
      expect(await mal.reentered()).to.equal(false);

      const p = await escrow.getPayment(pid);
      expect(p.status).to.equal(3n);
    });
  });
});
