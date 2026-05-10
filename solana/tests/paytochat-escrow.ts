import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PaytochatEscrow } from "../target/types/paytochat_escrow";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiAsPromised);

// --- helpers --------------------------------------------------------------

const SEED_CONFIG = Buffer.from("config");
const SEED_TOKEN_CONFIG = Buffer.from("token_config");
const SEED_VAULT = Buffer.from("vault");
const SEED_VAULT_AUTHORITY = Buffer.from("vault_authority");
const SEED_PAYMENT = Buffer.from("payment");

const FEE_BPS = 250; // 2.5%
const ONE_USDC = 1_000_000n; // 6 decimals

function newPaymentId(): Buffer {
  return randomBytes(32);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- fixture --------------------------------------------------------------

describe("paytochat-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .PaytochatEscrow as Program<PaytochatEscrow>;
  const programId = program.programId;

  const admin = Keypair.generate();
  const newAdmin = Keypair.generate();
  const sender = Keypair.generate();
  const recipient = Keypair.generate();
  const attacker = Keypair.generate();
  const treasury = Keypair.generate();

  const [configPda] = PublicKey.findProgramAddressSync([SEED_CONFIG], programId);
  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [SEED_VAULT_AUTHORITY],
    programId,
  );

  const tokenConfigPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [SEED_TOKEN_CONFIG, mint.toBuffer()],
      programId,
    )[0];
  const vaultPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [SEED_VAULT, mint.toBuffer()],
      programId,
    )[0];
  const paymentPda = (paymentId: Buffer) =>
    PublicKey.findProgramAddressSync([SEED_PAYMENT, paymentId], programId)[0];

  let usdc: PublicKey;
  let senderAta: PublicKey;
  let recipientAta: PublicKey;
  let attackerAta: PublicKey;
  let treasuryAta: PublicKey;

  async function airdrop(pubkey: PublicKey, sol = 5) {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  before(async () => {
    await Promise.all(
      [admin, newAdmin, sender, recipient, attacker, treasury].map((kp) =>
        airdrop(kp.publicKey),
      ),
    );

    usdc = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6,
    );

    senderAta = await createAccount(
      provider.connection,
      sender,
      usdc,
      sender.publicKey,
    );
    recipientAta = await createAccount(
      provider.connection,
      recipient,
      usdc,
      recipient.publicKey,
    );
    attackerAta = await createAccount(
      provider.connection,
      attacker,
      usdc,
      attacker.publicKey,
    );
    treasuryAta = await createAccount(
      provider.connection,
      treasury,
      usdc,
      treasury.publicKey,
    );

    await mintTo(
      provider.connection,
      admin,
      usdc,
      senderAta,
      admin,
      Number(1_000n * ONE_USDC),
    );
  });

  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  it("initialize sets admin + fee, rejects fee > MAX", async () => {
    await program.methods
      .initialize(admin.publicKey, FEE_BPS)
      .accounts({
        payer: provider.wallet.publicKey,
        config: configPda,
        vaultAuthority: vaultAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.config.fetch(configPda);
    expect(cfg.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    expect(cfg.feeBps).to.equal(FEE_BPS);
    expect(cfg.paused).to.equal(false);
    expect(cfg.pendingAdmin.toBase58()).to.equal(PublicKey.default.toBase58());
  });

  // -----------------------------------------------------------------------
  // admin
  // -----------------------------------------------------------------------

  it("set_fee_bps caps at MAX_FEE_BPS and only admin can call it", async () => {
    await expect(
      program.methods
        .setFeeBps(1001)
        .accounts({ config: configPda, admin: admin.publicKey })
        .signers([admin])
        .rpc(),
    ).to.be.rejectedWith(/FeeTooHigh/);

    await expect(
      program.methods
        .setFeeBps(100)
        .accounts({ config: configPda, admin: attacker.publicKey })
        .signers([attacker])
        .rpc(),
    ).to.be.rejectedWith(/NotAdmin|has_one|Unknown/);

    await program.methods
      .setFeeBps(FEE_BPS)
      .accounts({ config: configPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
  });

  it("set_token_allowed creates TokenConfig + Vault and toggles allowance", async () => {
    await program.methods
      .setTokenAllowed(true)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        payer: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const tc = await program.account.tokenConfig.fetch(tokenConfigPda(usdc));
    expect(tc.isAllowed).to.equal(true);
    expect(tc.mint.toBase58()).to.equal(usdc.toBase58());
    expect(tc.accumulatedFees.toString()).to.equal("0");

    // Vault token account exists and is owned by vault_authority PDA.
    const vault = await getAccount(provider.connection, vaultPda(usdc));
    expect(vault.owner.toBase58()).to.equal(vaultAuthorityPda.toBase58());
  });

  // -----------------------------------------------------------------------
  // deposit
  // -----------------------------------------------------------------------

  it("deposit happy path: pulls tokens into the vault and stores Pending", async () => {
    const pid = newPaymentId();
    const deadline = new BN(Math.floor(Date.now() / 1000) + 3600);
    await program.methods
      .deposit([...pid], new BN(ONE_USDC.toString()), deadline)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const p = await program.account.payment.fetch(paymentPda(pid));
    expect(p.sender.toBase58()).to.equal(sender.publicKey.toBase58());
    expect(p.recipient.toBase58()).to.equal(recipient.publicKey.toBase58());
    expect(p.amount.toString()).to.equal(ONE_USDC.toString());
    expect(p.status).to.equal(1); // Pending

    const vault = await getAccount(provider.connection, vaultPda(usdc));
    expect(vault.amount).to.equal(ONE_USDC);
  });

  it("deposit rejects: zero paymentId, zero amount, past deadline, self-recipient", async () => {
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    const accs = (pid: Buffer, recip = recipient.publicKey) => ({
      config: configPda,
      mint: usdc,
      tokenConfig: tokenConfigPda(usdc),
      payment: paymentPda(pid),
      recipient: recip,
      vault: vaultPda(usdc),
      vaultAuthority: vaultAuthorityPda,
      senderTokenAccount: senderAta,
      sender: sender.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

    // zero paymentId
    const zero = Buffer.alloc(32, 0);
    await expect(
      program.methods
        .deposit([...zero], new BN(ONE_USDC.toString()), dl)
        .accounts(accs(zero))
        .signers([sender])
        .rpc(),
    ).to.be.rejectedWith(/InvalidPaymentId/);

    // zero amount
    const pidA = newPaymentId();
    await expect(
      program.methods
        .deposit([...pidA], new BN(0), dl)
        .accounts(accs(pidA))
        .signers([sender])
        .rpc(),
    ).to.be.rejectedWith(/InvalidAmount/);

    // past deadline
    const pidB = newPaymentId();
    await expect(
      program.methods
        .deposit(
          [...pidB],
          new BN(ONE_USDC.toString()),
          new BN(Math.floor(Date.now() / 1000) - 1),
        )
        .accounts(accs(pidB))
        .signers([sender])
        .rpc(),
    ).to.be.rejectedWith(/InvalidDeadline/);

    // self recipient
    const pidC = newPaymentId();
    await expect(
      program.methods
        .deposit([...pidC], new BN(ONE_USDC.toString()), dl)
        .accounts(accs(pidC, sender.publicKey))
        .signers([sender])
        .rpc(),
    ).to.be.rejectedWith(/InvalidRecipient/);
  });

  it("deposit rejects payment_id reuse while Pending", async () => {
    const pid = newPaymentId();
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .deposit([...pid], new BN(ONE_USDC.toString()), dl)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    // re-deposit with same paymentId — the Payment PDA already exists,
    // so Anchor's `init` constraint fails.
    await expect(
      program.methods
        .deposit([...pid], new BN(ONE_USDC.toString()), dl)
        .accounts({
          config: configPda,
          mint: usdc,
          tokenConfig: tokenConfigPda(usdc),
          payment: paymentPda(pid),
          recipient: recipient.publicKey,
          vault: vaultPda(usdc),
          vaultAuthority: vaultAuthorityPda,
          senderTokenAccount: senderAta,
          sender: sender.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc(),
    ).to.be.rejected;
  });

  // -----------------------------------------------------------------------
  // claim
  // -----------------------------------------------------------------------

  it("claim happy path: recipient gets amount-fee, fees accumulate, payment closed", async () => {
    const pid = newPaymentId();
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .deposit([...pid], new BN(ONE_USDC.toString()), dl)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const recipBefore = (await getAccount(provider.connection, recipientAta))
      .amount;
    const tcBefore = await program.account.tokenConfig.fetch(
      tokenConfigPda(usdc),
    );

    await program.methods
      .claim([...pid])
      .accounts({
        config: configPda,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        sender: sender.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        recipientTokenAccount: recipientAta,
        recipient: recipient.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([recipient])
      .rpc();

    const fee = (ONE_USDC * BigInt(FEE_BPS)) / 10_000n;
    const toR = ONE_USDC - fee;

    const recipAfter = (await getAccount(provider.connection, recipientAta))
      .amount;
    expect(recipAfter - recipBefore).to.equal(toR);

    const tcAfter = await program.account.tokenConfig.fetch(
      tokenConfigPda(usdc),
    );
    expect(
      BigInt(tcAfter.accumulatedFees.toString()) -
        BigInt(tcBefore.accumulatedFees.toString()),
    ).to.equal(fee);

    // Payment account is closed -> fetch should fail.
    await expect(
      program.account.payment.fetch(paymentPda(pid)),
    ).to.be.rejected;
  });

  it("claim rejects non-recipient", async () => {
    const pid = newPaymentId();
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .deposit([...pid], new BN(ONE_USDC.toString()), dl)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    await expect(
      program.methods
        .claim([...pid])
        .accounts({
          config: configPda,
          tokenConfig: tokenConfigPda(usdc),
          payment: paymentPda(pid),
          sender: sender.publicKey,
          vault: vaultPda(usdc),
          vaultAuthority: vaultAuthorityPda,
          recipientTokenAccount: attackerAta,
          recipient: attacker.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
    ).to.be.rejectedWith(/NotRecipient|address|ConstraintAddress/);
  });

  // -----------------------------------------------------------------------
  // refund
  // -----------------------------------------------------------------------

  it("refund happy path: only after deadline, only by sender, full amount back", async () => {
    const pid = newPaymentId();
    // Short deadline so we can sleep past it without slowing the suite too much.
    const dl = new BN(Math.floor(Date.now() / 1000) + 2);
    await program.methods
      .deposit([...pid], new BN(ONE_USDC.toString()), dl)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    // Before the deadline -> rejected.
    await expect(
      program.methods
        .refund([...pid])
        .accounts({
          config: configPda,
          payment: paymentPda(pid),
          vault: vaultPda(usdc),
          vaultAuthority: vaultAuthorityPda,
          senderTokenAccount: senderAta,
          sender: sender.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([sender])
        .rpc(),
    ).to.be.rejectedWith(/DeadlineNotPassed/);

    await sleep(3_500);

    const senderBefore = (await getAccount(provider.connection, senderAta))
      .amount;

    await program.methods
      .refund([...pid])
      .accounts({
        config: configPda,
        payment: paymentPda(pid),
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([sender])
      .rpc();

    const senderAfter = (await getAccount(provider.connection, senderAta))
      .amount;
    expect(senderAfter - senderBefore).to.equal(ONE_USDC);

    // Payment account is closed -> fetch fails.
    await expect(
      program.account.payment.fetch(paymentPda(pid)),
    ).to.be.rejected;
  });

  // -----------------------------------------------------------------------
  // pause
  // -----------------------------------------------------------------------

  it("pause blocks deposits but NOT claim/refund", async () => {
    // Stash one Pending deposit to claim while paused.
    const pid = newPaymentId();
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .deposit([...pid], new BN(ONE_USDC.toString()), dl)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    await program.methods
      .setPaused(true)
      .accounts({ config: configPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // Deposits blocked.
    const pidNew = newPaymentId();
    await expect(
      program.methods
        .deposit([...pidNew], new BN(ONE_USDC.toString()), dl)
        .accounts({
          config: configPda,
          mint: usdc,
          tokenConfig: tokenConfigPda(usdc),
          payment: paymentPda(pidNew),
          recipient: recipient.publicKey,
          vault: vaultPda(usdc),
          vaultAuthority: vaultAuthorityPda,
          senderTokenAccount: senderAta,
          sender: sender.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc(),
    ).to.be.rejectedWith(/Paused/);

    // Claim still works.
    await program.methods
      .claim([...pid])
      .accounts({
        config: configPda,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pid),
        sender: sender.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        recipientTokenAccount: recipientAta,
        recipient: recipient.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([recipient])
      .rpc();

    await program.methods
      .setPaused(false)
      .accounts({ config: configPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
  });

  // -----------------------------------------------------------------------
  // withdraw_fees
  // -----------------------------------------------------------------------

  it("withdraw_fees: admin sweeps accumulated fees to treasury, can never reach principal", async () => {
    // Park a Pending deposit so the vault holds principal we shouldn't touch.
    const pidPending = newPaymentId();
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    await program.methods
      .deposit([...pidPending], new BN(ONE_USDC.toString()), dl)
      .accounts({
        config: configPda,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        payment: paymentPda(pidPending),
        recipient: recipient.publicKey,
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        senderTokenAccount: senderAta,
        sender: sender.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sender])
      .rpc();

    const tc = await program.account.tokenConfig.fetch(tokenConfigPda(usdc));
    const fees = BigInt(tc.accumulatedFees.toString());
    expect(fees > 0n).to.equal(true);

    const treasuryBefore = (await getAccount(provider.connection, treasuryAta))
      .amount;
    const vaultBefore = (await getAccount(provider.connection, vaultPda(usdc)))
      .amount;

    await program.methods
      .withdrawFees()
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        mint: usdc,
        tokenConfig: tokenConfigPda(usdc),
        vault: vaultPda(usdc),
        vaultAuthority: vaultAuthorityPda,
        destination: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const treasuryAfter = (await getAccount(provider.connection, treasuryAta))
      .amount;
    expect(treasuryAfter - treasuryBefore).to.equal(fees);

    const tcAfter = await program.account.tokenConfig.fetch(
      tokenConfigPda(usdc),
    );
    expect(tcAfter.accumulatedFees.toString()).to.equal("0");

    // The withdraw cannot reach principal — vault balance drops by EXACTLY
    // the accumulated fee amount, no more. Whatever's left equals the
    // still-Pending escrow principal accumulated by earlier tests.
    const vaultAfter = (await getAccount(provider.connection, vaultPda(usdc)))
      .amount;
    expect(vaultBefore - vaultAfter).to.equal(fees);

    // A second withdraw_fees with no accumulated fees must revert.
    await expect(
      program.methods
        .withdrawFees()
        .accounts({
          config: configPda,
          admin: admin.publicKey,
          mint: usdc,
          tokenConfig: tokenConfigPda(usdc),
          vault: vaultPda(usdc),
          vaultAuthority: vaultAuthorityPda,
          destination: treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc(),
    ).to.be.rejectedWith(/NoFeesToWithdraw/);
  });

  // -----------------------------------------------------------------------
  // admin transfer (two-step)
  // -----------------------------------------------------------------------

  it("transfer_admin + accept_admin is a two-step (Ownable2Step parity)", async () => {
    await program.methods
      .transferAdmin(newAdmin.publicKey)
      .accounts({ config: configPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    let cfg = await program.account.config.fetch(configPda);
    expect(cfg.pendingAdmin.toBase58()).to.equal(newAdmin.publicKey.toBase58());
    expect(cfg.admin.toBase58()).to.equal(admin.publicKey.toBase58());

    // Wrong account cannot accept.
    await expect(
      program.methods
        .acceptAdmin()
        .accounts({ config: configPda, newAdmin: attacker.publicKey })
        .signers([attacker])
        .rpc(),
    ).to.be.rejectedWith(/NotPendingAdmin/);

    await program.methods
      .acceptAdmin()
      .accounts({ config: configPda, newAdmin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();

    cfg = await program.account.config.fetch(configPda);
    expect(cfg.admin.toBase58()).to.equal(newAdmin.publicKey.toBase58());
    expect(cfg.pendingAdmin.toBase58()).to.equal(PublicKey.default.toBase58());

    // Old admin no longer has admin powers.
    await expect(
      program.methods
        .setFeeBps(123)
        .accounts({ config: configPda, admin: admin.publicKey })
        .signers([admin])
        .rpc(),
    ).to.be.rejected;

    // Hand it back so subsequent tests (none after this one) still work
    // if the suite is re-ordered.
    await program.methods
      .transferAdmin(admin.publicKey)
      .accounts({ config: configPda, admin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();
    await program.methods
      .acceptAdmin()
      .accounts({ config: configPda, newAdmin: admin.publicKey })
      .signers([admin])
      .rpc();
  });
});
