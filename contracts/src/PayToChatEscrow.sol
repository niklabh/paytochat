// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PayToChatEscrow
 * @notice Holds an ERC-20 tip from a sender until either:
 *           1. the recipient claims it (contract takes a small fee), or
 *           2. the deadline passes and the sender refunds it.
 *         Designed for paytochat.fun's "tip a stranger to land in their inbox"
 *         flow, but is fully chain-agnostic — any backend can drive it.
 *
 *         Security model:
 *           - Only allowlisted ERC-20 tokens can be deposited (defends against
 *             malicious tokens, fee-on-transfer surprises, rebasing tokens).
 *           - Fee is capped at MAX_FEE_BPS (10 %) at the contract level so even
 *             a compromised owner cannot drain claims.
 *           - SafeERC20 is used everywhere so non-standard tokens that don't
 *             return a bool (USDT) work correctly.
 *           - All state-changing functions are nonReentrant; the
 *             checks-effects-interactions order is followed in every external.
 *           - Pause only blocks new deposits. Claim and refund must always
 *             work so user funds can never be trapped by the admin.
 *           - The owner can withdraw only `accumulatedFees[token]`, never the
 *             principal escrowed for users. There is no rescue / sweep that
 *             could touch user funds.
 *           - Two-step ownership transfer (Ownable2Step) prevents typo'ing
 *             admin rights to a wrong / dead address.
 *           - paymentId is supplied by the off-chain caller (typically a UUID
 *             padded to bytes32). Reuse is rejected. Callers SHOULD use
 *             enough entropy (>=128 bits) that mempool front-running griefs
 *             are infeasible; if a paymentId ever does collide, the loser can
 *             retry with a fresh id at the cost of one reverted tx.
 */
contract PayToChatEscrow is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum Status {
        None, // 0 — never created
        Pending, // 1 — escrowed, awaiting claim or refund
        Claimed, // 2 — recipient took the funds
        Refunded // 3 — sender pulled the funds back after deadline
    }

    /// @dev Packed into two 32-byte slots:
    ///      slot 0: sender (20) + amount (16) — fits in 32 bytes? 20+16=36, no.
    ///      So layout is two slots; recipient + token + deadline + status pack
    ///      into the second slot.
    struct Payment {
        address sender; // who escrowed the tokens
        uint128 amount; // actual amount escrowed (post fee-on-transfer)
        address recipient; // who can claim them
        IERC20 token; // ERC-20 contract
        uint64 deadline; // refund unlocks strictly AFTER this timestamp
        Status status;
    }

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// @notice Hard cap on the claim fee. Owner cannot exceed this.
    uint16 public constant MAX_FEE_BPS = 1_000; // 10 %
    uint16 public constant BPS_DENOMINATOR = 10_000;

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// @notice Current claim fee in basis points (1 bp = 0.01 %).
    uint16 public feeBps;

    /// @notice Tokens that may be deposited. Anything else reverts on deposit.
    mapping(IERC20 => bool) public tokenAllowed;

    /// @notice paymentId => Payment record.
    mapping(bytes32 => Payment) private _payments;

    /// @notice Per-token accumulated fee balance owned by the admin.
    mapping(IERC20 => uint256) public accumulatedFees;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event TokenAllowlistUpdated(IERC20 indexed token, bool allowed);
    event FeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event Deposited(
        bytes32 indexed paymentId,
        address indexed sender,
        address indexed recipient,
        IERC20 token,
        uint256 amount,
        uint64 deadline
    );
    event Claimed(
        bytes32 indexed paymentId,
        address indexed recipient,
        IERC20 token,
        uint256 amountToRecipient,
        uint256 fee
    );
    event Refunded(
        bytes32 indexed paymentId,
        address indexed sender,
        IERC20 token,
        uint256 amount
    );
    event FeesWithdrawn(IERC20 indexed token, address indexed to, uint256 amount);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error InvalidPaymentId();
    error PaymentExists();
    error InvalidStatus();
    error TokenNotAllowed();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidDeadline();
    error NotRecipient();
    error NotSender();
    error DeadlineNotPassed();
    error FeeTooHigh();
    error NoFeesToWithdraw();
    error ZeroAddress();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param initialOwner Address that becomes the admin (fee recipient).
     * @param initialFeeBps Initial claim fee in basis points (e.g. 250 = 2.5 %).
     *                     Must be <= MAX_FEE_BPS.
     */
    constructor(address initialOwner, uint16 initialFeeBps) Ownable(initialOwner) {
        // Zero-owner is already rejected by Ownable's constructor with
        // OwnableInvalidOwner — no need to re-check here.
        if (initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = initialFeeBps;
        emit FeeUpdated(0, initialFeeBps);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /// @notice Allow or disallow a token for new deposits. Existing
    ///         deposits in a now-disallowed token can still be claimed/refunded.
    function setTokenAllowed(IERC20 token, bool allowed) external onlyOwner {
        if (address(token) == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenAllowlistUpdated(token, allowed);
    }

    /// @notice Update the per-claim fee. Capped at MAX_FEE_BPS.
    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Stop accepting new deposits. Does NOT block claim or refund.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraw all fees that have accrued in `token` to `to`.
    ///         Can never withdraw user-escrowed principal — only the
    ///         `accumulatedFees[token]` accounting balance.
    function withdrawFees(IERC20 token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = accumulatedFees[token];
        if (amount == 0) revert NoFeesToWithdraw();
        accumulatedFees[token] = 0;
        token.safeTransfer(to, amount);
        emit FeesWithdrawn(token, to, amount);
    }

    // -----------------------------------------------------------------------
    // Core flow
    // -----------------------------------------------------------------------

    /**
     * @notice Escrow `amount` of `token` for `recipient`, refundable to
     *         msg.sender after `deadline`.
     * @dev    Sender must have approve()'d this contract for at least `amount`
     *         on `token` first.
     *
     *         Fee-on-transfer tokens are tolerated: the contract escrows
     *         exactly the amount it actually receives (which may be < amount).
     *         Rebasing tokens are NOT supported and should not be allowlisted.
     *
     * @param paymentId  Unique 32-byte id chosen by the caller (e.g. UUID
     *                   padded right). Cannot be 0x0; cannot be reused.
     * @param recipient  Address that may later call claim().
     * @param token      ERC-20 contract; must be allowlisted.
     * @param amount     Token-units to pull from msg.sender.
     * @param deadline   UNIX timestamp; refund() works strictly after this.
     */
    function deposit(
        bytes32 paymentId,
        address recipient,
        IERC20 token,
        uint256 amount,
        uint64 deadline
    ) external nonReentrant whenNotPaused {
        if (paymentId == bytes32(0)) revert InvalidPaymentId();
        if (recipient == address(0)) revert InvalidRecipient();
        if (recipient == msg.sender) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        if (_payments[paymentId].status != Status.None) revert PaymentExists();

        // Measure actual received amount to be safe with fee-on-transfer.
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balBefore;
        if (received == 0) revert InvalidAmount();
        if (received > type(uint128).max) revert InvalidAmount();

        _payments[paymentId] = Payment({
            sender: msg.sender,
            amount: uint128(received),
            recipient: recipient,
            token: token,
            deadline: deadline,
            status: Status.Pending
        });

        emit Deposited(paymentId, msg.sender, recipient, token, received, deadline);
    }

    /**
     * @notice Claim a Pending payment. Sends `amount - fee` to msg.sender
     *         and credits `fee` to the admin's withdrawable bucket.
     * @dev    State (status, accumulatedFees) is updated BEFORE the external
     *         token transfer; combined with nonReentrant this defangs both
     *         classic and cross-function reentrancy attempts via a malicious
     *         token (in the unlikely event one is ever allowlisted).
     */
    function claim(bytes32 paymentId) external nonReentrant {
        Payment storage p = _payments[paymentId];
        if (p.status != Status.Pending) revert InvalidStatus();
        if (msg.sender != p.recipient) revert NotRecipient();

        uint256 amount = p.amount;
        uint256 fee = (amount * feeBps) / BPS_DENOMINATOR;
        // amount fits in uint128, fee <= amount, so subtraction is safe.
        uint256 toRecipient = amount - fee;

        IERC20 token = p.token;

        p.status = Status.Claimed;
        if (fee > 0) {
            accumulatedFees[token] += fee;
        }

        if (toRecipient > 0) {
            token.safeTransfer(p.recipient, toRecipient);
        }

        emit Claimed(paymentId, p.recipient, token, toRecipient, fee);
    }

    /**
     * @notice Refund a Pending payment to the sender. Only callable strictly
     *         AFTER the deadline. No fee is taken on refund — the sender
     *         gets the full escrowed amount back.
     */
    function refund(bytes32 paymentId) external nonReentrant {
        Payment storage p = _payments[paymentId];
        if (p.status != Status.Pending) revert InvalidStatus();
        if (msg.sender != p.sender) revert NotSender();
        if (block.timestamp <= p.deadline) revert DeadlineNotPassed();

        uint256 amount = p.amount;
        IERC20 token = p.token;
        address sender = p.sender;

        p.status = Status.Refunded;

        token.safeTransfer(sender, amount);

        emit Refunded(paymentId, sender, token, amount);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    /// @notice Convenience view for the UI — quotes the (toRecipient, fee)
    ///         split that a claim() would produce right now for `paymentId`.
    function quoteClaim(bytes32 paymentId)
        external
        view
        returns (uint256 toRecipient, uint256 fee)
    {
        Payment storage p = _payments[paymentId];
        if (p.status != Status.Pending) return (0, 0);
        uint256 amount = p.amount;
        fee = (amount * feeBps) / BPS_DENOMINATOR;
        toRecipient = amount - fee;
    }
}
