// Anchor's proc-macros (and solana-program) reference internal feature
// gates (`anchor-debug`, `custom-heap`, `custom-panic`, `solana`) that
// aren't declared in our Cargo.toml. They're cosmetic, originate from
// upstream macro expansions, and the warning persists on Anchor 0.32 +
// rustc's stricter unexpected_cfgs lint, so we silence it crate-wide.
#![allow(unexpected_cfgs)]

//! Pay to Chat — SPL escrow program.
//!
//! Mirrors `contracts/src/PayToChatEscrow.sol`:
//!   - Sender deposits SPL tokens for a recipient with a refund deadline.
//!   - Recipient claims; the program retains a configurable fee (capped at
//!     10 %) per claim; the rest goes to the recipient.
//!   - Sender can refund strictly after the deadline if the payment is
//!     still Pending.
//!   - Admin (a two-step transferable Pubkey, ideally a multisig like
//!     Squads or a governance program) can withdraw accumulated per-mint
//!     fees, allowlist mints, change the fee, and pause new deposits.
//!     Pause never blocks claim or refund — user funds can never be
//!     trapped by the admin.
//!
//! Account layout
//! --------------
//!   Config  PDA  ["config"]                — admin, fee, paused
//!   TokenConfig PDA  ["token_config", mint] — allowlist + accumulated fees
//!   Vault token account PDA  ["vault", mint] — holds principal + fees
//!   VaultAuthority PDA  ["vault_authority"]  — owner of every vault
//!   Payment PDA  ["payment", payment_id]    — one per active deposit
//!
//! Security model
//! --------------
//!   - All vault token accounts are owned by a single PDA
//!     (`["vault_authority"]`) so only this program can move tokens out.
//!   - Per-payment Payment PDAs are `init` so a paymentId can never be
//!     used twice for an active deposit (matches the EVM `PaymentExists`
//!     revert). When the payment is Claimed or Refunded the account is
//!     closed and rent returns to the sender, so the same paymentId is
//!     reusable for an entirely separate later message — but never
//!     concurrently. Off-chain layers should still mint a fresh random
//!     paymentId per message; the on-chain check is a backstop.
//!   - Status flag is flipped, fee accounting is updated, and the account
//!     is queued for close BEFORE the SPL CPI transfer. Solana's runtime
//!     forbids classic reentrancy (a program cannot recursively invoke
//!     itself), but this ordering is still good hygiene against any
//!     future CPI-callback shenanigans.
//!   - Fee is hard-capped at MAX_FEE_BPS = 1_000 (10 %) at the program
//!     level. Even a compromised admin cannot exceed this.
//!   - Admin can never withdraw user-escrowed principal — only the
//!     `accumulated_fees` accounting balance per mint.
//!   - Two-step admin transfer (`transfer_admin` then `accept_admin` from
//!     the new admin) prevents a typo from locking the program.
//!   - Allowlist of mints — only admin-enabled mints may be deposited.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("EFfsYcyU8L6K7rKGW5wbwrn5EiVqhL6yyr6xBqxc3rwB");

pub const MAX_FEE_BPS: u16 = 1_000;
pub const BPS_DENOMINATOR: u64 = 10_000;

const SEED_CONFIG: &[u8] = b"config";
const SEED_TOKEN_CONFIG: &[u8] = b"token_config";
const SEED_VAULT: &[u8] = b"vault";
const SEED_VAULT_AUTHORITY: &[u8] = b"vault_authority";
const SEED_PAYMENT: &[u8] = b"payment";

#[program]
pub mod paytochat_escrow {
    use super::*;

    // -------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------

    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey, fee_bps: u16) -> Result<()> {
        require!(admin != Pubkey::default(), EscrowError::ZeroAddress);
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);

        let config = &mut ctx.accounts.config;
        config.admin = admin;
        config.pending_admin = Pubkey::default();
        config.fee_bps = fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.vault_authority_bump = ctx.bumps.vault_authority;

        emit!(InitializedEvent { admin, fee_bps });
        Ok(())
    }

    // -------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------

    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), EscrowError::ZeroAddress);
        ctx.accounts.config.pending_admin = new_admin;
        emit!(AdminTransferStartedEvent {
            current_admin: ctx.accounts.config.admin,
            pending_admin: new_admin,
        });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_admin != Pubkey::default(),
            EscrowError::NoPendingAdmin
        );
        require!(
            ctx.accounts.new_admin.key() == config.pending_admin,
            EscrowError::NotPendingAdmin
        );
        let new_admin = config.pending_admin;
        config.admin = new_admin;
        config.pending_admin = Pubkey::default();
        emit!(AdminTransferredEvent { new_admin });
        Ok(())
    }

    pub fn set_fee_bps(ctx: Context<AdminOnly>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        let old = ctx.accounts.config.fee_bps;
        ctx.accounts.config.fee_bps = new_fee_bps;
        emit!(FeeUpdatedEvent {
            old_fee_bps: old,
            new_fee_bps,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedEvent { paused });
        Ok(())
    }

    /// Allow or disallow a mint for new deposits. The Vault token account
    /// and the TokenConfig PDA are created on first allowlisting.
    /// Existing pending payments in a now-disallowed mint can still be
    /// claimed and refunded — the allowlist gate is only on `deposit`.
    pub fn set_token_allowed(ctx: Context<SetTokenAllowed>, allowed: bool) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = ctx.accounts.mint.key();
        token_config.is_allowed = allowed;
        token_config.bump = ctx.bumps.token_config;
        emit!(TokenAllowlistEvent {
            mint: ctx.accounts.mint.key(),
            allowed,
        });
        Ok(())
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        let amount = ctx.accounts.token_config.accumulated_fees;
        require!(amount > 0, EscrowError::NoFeesToWithdraw);

        ctx.accounts.token_config.accumulated_fees = 0;

        let bump = ctx.accounts.config.vault_authority_bump;
        let seeds: &[&[u8]] = &[SEED_VAULT_AUTHORITY, &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(FeesWithdrawnEvent {
            mint: ctx.accounts.mint.key(),
            destination: ctx.accounts.destination.key(),
            amount,
        });
        Ok(())
    }

    // -------------------------------------------------------------------
    // Core flow
    // -------------------------------------------------------------------

    pub fn deposit(
        ctx: Context<Deposit>,
        payment_id: [u8; 32],
        amount: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(payment_id != [0u8; 32], EscrowError::InvalidPaymentId);
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(!ctx.accounts.config.paused, EscrowError::Paused);
        require!(
            ctx.accounts.token_config.is_allowed,
            EscrowError::TokenNotAllowed
        );
        require!(
            ctx.accounts.recipient.key() != ctx.accounts.sender.key(),
            EscrowError::InvalidRecipient
        );
        require!(
            ctx.accounts.recipient.key() != Pubkey::default(),
            EscrowError::InvalidRecipient
        );

        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, EscrowError::InvalidDeadline);

        // Effects: persist payment metadata BEFORE the SPL transfer.
        let payment = &mut ctx.accounts.payment;
        payment.payment_id = payment_id;
        payment.sender = ctx.accounts.sender.key();
        payment.recipient = ctx.accounts.recipient.key();
        payment.mint = ctx.accounts.mint.key();
        payment.amount = amount;
        payment.deadline = deadline;
        payment.status = PaymentStatus::Pending as u8;
        payment.bump = ctx.bumps.payment;

        // Interaction: SPL transfer from the sender's token account into
        // the per-mint vault.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sender_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.sender.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(DepositedEvent {
            payment_id,
            sender: payment.sender,
            recipient: payment.recipient,
            mint: payment.mint,
            amount,
            deadline,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, _payment_id: [u8; 32]) -> Result<()> {
        let payment = &mut ctx.accounts.payment;
        require!(
            payment.status == PaymentStatus::Pending as u8,
            EscrowError::InvalidStatus
        );
        // Recipient identity is enforced via the `address = payment.recipient`
        // constraint on the `recipient` signer in the Claim accounts struct.

        let amount = payment.amount;
        let fee_bps = ctx.accounts.config.fee_bps as u64;
        let fee = amount
            .checked_mul(fee_bps)
            .ok_or(EscrowError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(EscrowError::Overflow)?;
        let to_recipient = amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

        // Effects.
        payment.status = PaymentStatus::Claimed as u8;
        ctx.accounts.token_config.accumulated_fees = ctx
            .accounts
            .token_config
            .accumulated_fees
            .checked_add(fee)
            .ok_or(EscrowError::Overflow)?;

        // Capture for the event (payment is closed at end of ix).
        let payment_id = payment.payment_id;
        let recipient = payment.recipient;
        let mint = payment.mint;

        // Interaction: vault -> recipient ATA. Vault is owned by the
        // vault_authority PDA, which signs via seeds.
        if to_recipient > 0 {
            let bump = ctx.accounts.config.vault_authority_bump;
            let seeds: &[&[u8]] = &[SEED_VAULT_AUTHORITY, &[bump]];
            let signer_seeds = &[seeds];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.vault_authority.to_account_info(),
                    },
                    signer_seeds,
                ),
                to_recipient,
            )?;
        }

        emit!(ClaimedEvent {
            payment_id,
            recipient,
            mint,
            amount_to_recipient: to_recipient,
            fee,
        });
        // The Payment account is closed by the `close = sender` constraint
        // when the instruction returns; the rent lamports go back to the
        // original sender.
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>, _payment_id: [u8; 32]) -> Result<()> {
        let payment = &mut ctx.accounts.payment;
        require!(
            payment.status == PaymentStatus::Pending as u8,
            EscrowError::InvalidStatus
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now > payment.deadline, EscrowError::DeadlineNotPassed);
        // Sender identity is enforced via `address = payment.sender` on
        // the `sender` signer.

        let amount = payment.amount;
        let payment_id = payment.payment_id;
        let mint = payment.mint;
        let sender_pk = payment.sender;

        payment.status = PaymentStatus::Refunded as u8;

        let bump = ctx.accounts.config.vault_authority_bump;
        let seeds: &[&[u8]] = &[SEED_VAULT_AUTHORITY, &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.sender_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(RefundedEvent {
            payment_id,
            sender: sender_pk,
            mint,
            amount,
        });
        Ok(())
    }
}

// =========================================================================
// Account state
// =========================================================================

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
    pub vault_authority_bump: u8,
}

impl Config {
    // 8 disc + 32 + 32 + 2 + 1 + 1 + 1
    pub const LEN: usize = 8 + 32 + 32 + 2 + 1 + 1 + 1;
}

#[account]
pub struct TokenConfig {
    pub mint: Pubkey,
    pub is_allowed: bool,
    pub accumulated_fees: u64,
    pub bump: u8,
}

impl TokenConfig {
    // 8 disc + 32 + 1 + 8 + 1
    pub const LEN: usize = 8 + 32 + 1 + 8 + 1;
}

#[account]
pub struct Payment {
    pub payment_id: [u8; 32],
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub status: u8,
    pub bump: u8,
}

impl Payment {
    // 8 disc + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum PaymentStatus {
    Pending = 1,
    Claimed = 2,
    Refunded = 3,
}

// =========================================================================
// Account contexts
// =========================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Config::LEN,
        seeds = [SEED_CONFIG],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: PDA used as authority for every per-mint vault token account.
    #[account(seeds = [SEED_VAULT_AUTHORITY], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ EscrowError::NotAdmin,
    )]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub new_admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetTokenAllowed<'info> {
    #[account(
        mut,
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ EscrowError::NotAdmin,
    )]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        space = TokenConfig::LEN,
        seeds = [SEED_TOKEN_CONFIG, mint.key().as_ref()],
        bump,
    )]
    pub token_config: Account<'info, TokenConfig>,

    /// Per-mint vault. Owned by `vault_authority` PDA, so only this
    /// program (with the right seeds) can move tokens out.
    #[account(
        init_if_needed,
        payer = payer,
        token::mint = mint,
        token::authority = vault_authority,
        seeds = [SEED_VAULT, mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA validated by seeds.
    #[account(seeds = [SEED_VAULT_AUTHORITY], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        has_one = admin @ EscrowError::NotAdmin,
    )]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [SEED_TOKEN_CONFIG, mint.key().as_ref()],
        bump = token_config.bump,
        has_one = mint @ EscrowError::TokenMismatch,
    )]
    pub token_config: Account<'info, TokenConfig>,

    #[account(
        mut,
        seeds = [SEED_VAULT, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA validated by seeds.
    #[account(seeds = [SEED_VAULT_AUTHORITY], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut, token::mint = mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct Deposit<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [SEED_TOKEN_CONFIG, mint.key().as_ref()],
        bump = token_config.bump,
        has_one = mint @ EscrowError::TokenMismatch,
    )]
    pub token_config: Account<'info, TokenConfig>,

    /// New per-payment PDA. `init` ensures the same payment_id cannot be
    /// used while a previous deposit with that id is still Pending.
    #[account(
        init,
        payer = sender,
        space = Payment::LEN,
        seeds = [SEED_PAYMENT, payment_id.as_ref()],
        bump,
    )]
    pub payment: Account<'info, Payment>,

    /// CHECK: stored as the future claimer; identity check happens in
    /// `claim` via `address = payment.recipient`.
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_VAULT, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA validated by seeds.
    #[account(seeds = [SEED_VAULT_AUTHORITY], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sender,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct Claim<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SEED_TOKEN_CONFIG, payment.mint.as_ref()],
        bump = token_config.bump,
    )]
    pub token_config: Account<'info, TokenConfig>,

    /// Closing back to the original sender returns the rent lamports.
    /// `address = payment.sender` ensures this is the right account.
    #[account(
        mut,
        close = sender,
        seeds = [SEED_PAYMENT, payment_id.as_ref()],
        bump = payment.bump,
    )]
    pub payment: Account<'info, Payment>,

    /// Original sender, used solely as the rent-return target. Does not
    /// need to sign; just needs to match `payment.sender`.
    /// CHECK: address constraint enforces correctness.
    #[account(mut, address = payment.sender @ EscrowError::SenderMismatch)]
    pub sender: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_VAULT, payment.mint.as_ref()],
        bump,
        token::mint = payment.mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA validated by seeds.
    #[account(seeds = [SEED_VAULT_AUTHORITY], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = payment.mint,
        token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(address = payment.recipient @ EscrowError::NotRecipient)]
    pub recipient: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct Refund<'info> {
    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        close = sender,
        seeds = [SEED_PAYMENT, payment_id.as_ref()],
        bump = payment.bump,
    )]
    pub payment: Account<'info, Payment>,

    #[account(
        mut,
        seeds = [SEED_VAULT, payment.mint.as_ref()],
        bump,
        token::mint = payment.mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA validated by seeds.
    #[account(seeds = [SEED_VAULT_AUTHORITY], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = payment.mint,
        token::authority = sender,
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    #[account(mut, address = payment.sender @ EscrowError::NotSender)]
    pub sender: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// =========================================================================
// Events
// =========================================================================

#[event]
pub struct InitializedEvent {
    pub admin: Pubkey,
    pub fee_bps: u16,
}

#[event]
pub struct AdminTransferStartedEvent {
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferredEvent {
    pub new_admin: Pubkey,
}

#[event]
pub struct FeeUpdatedEvent {
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
}

#[event]
pub struct PausedEvent {
    pub paused: bool,
}

#[event]
pub struct TokenAllowlistEvent {
    pub mint: Pubkey,
    pub allowed: bool,
}

#[event]
pub struct DepositedEvent {
    pub payment_id: [u8; 32],
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub deadline: i64,
}

#[event]
pub struct ClaimedEvent {
    pub payment_id: [u8; 32],
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount_to_recipient: u64,
    pub fee: u64,
}

#[event]
pub struct RefundedEvent {
    pub payment_id: [u8; 32],
    pub sender: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FeesWithdrawnEvent {
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

// =========================================================================
// Errors
// =========================================================================

#[error_code]
pub enum EscrowError {
    #[msg("payment_id is all zeros")]
    InvalidPaymentId,
    #[msg("payment is not in Pending status")]
    InvalidStatus,
    #[msg("token mint is not allowlisted")]
    TokenNotAllowed,
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("recipient is invalid (zero or self)")]
    InvalidRecipient,
    #[msg("deadline must be in the future")]
    InvalidDeadline,
    #[msg("only the recipient can claim this payment")]
    NotRecipient,
    #[msg("only the original sender can refund this payment")]
    NotSender,
    #[msg("deadline has not passed yet")]
    DeadlineNotPassed,
    #[msg("fee exceeds the hard cap (1000 bps = 10%)")]
    FeeTooHigh,
    #[msg("no fees accumulated for this mint")]
    NoFeesToWithdraw,
    #[msg("admin pubkey cannot be the zero address")]
    ZeroAddress,
    #[msg("only the admin can perform this action")]
    NotAdmin,
    #[msg("no pending admin transfer is in progress")]
    NoPendingAdmin,
    #[msg("only the pending_admin can accept the transfer")]
    NotPendingAdmin,
    #[msg("token mismatch between accounts")]
    TokenMismatch,
    #[msg("rent-return target does not match payment.sender")]
    SenderMismatch,
    #[msg("u64 overflow in fee math")]
    Overflow,
    #[msg("program is paused; new deposits are blocked")]
    Paused,
}
