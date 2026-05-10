import type { Timestamp } from "firebase/firestore";

export type Chain = "ethereum" | "solana";
export type Token = "USDC" | "USDT";

export interface UserDoc {
  uid: string;
  handle: string;
  handleLower: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  createdAt: Timestamp | number;
  wallets: {
    ethereum?: string;
    solana?: string;
  };
  socials?: {
    x?: string;
    instagram?: string;
    website?: string;
  };
  settings: {
    /** Messages whose paid amount is below this are auto-rejected. */
    minThresholdUSD: number;
    /** Push/email notification fires only when a message exceeds this. */
    notifyThresholdUSD: number;
    /** After a paid message, sender can reply free for this many days. */
    coolOffDays: number;
    /** Default disclaimer or auto-reply template for X/IG. */
    autoReplyTemplate?: string;
    /** Allow only specific chains. */
    acceptedChains: Chain[];
    /** Allow only specific tokens. */
    acceptedTokens: Token[];
    /** Email me when a new (qualifying) message arrives. */
    emailNotifications: boolean;
  };
  stats: {
    totalEarnedUSD: number;
    messagesReceived: number;
    messagesOpened: number;
  };
}

export type MessageStatus =
  | "pending" // sender initiated, awaiting tx confirmation
  | "paid" // tx confirmed (escrow holds the funds), awaiting recipient open
  | "opened" // recipient revealed (still claimable while paymentId is Pending)
  | "claimed" // recipient pulled the escrowed tokens to their wallet
  | "refunded" // sender pulled the escrowed tokens back after deadline
  | "rejected" // below recipient threshold
  | "free"; // free reply sent during the cool-off window

export interface MessageDoc {
  id: string;
  conversationId: string;
  /**
   * Id of the thread this message belongs to. For paid messages this is
   * the message's own id (set when the recipient claims it); for free
   * in-thread replies this is the anchor paid message's id. Used to scope
   * the per-thread chat view and to gate free replies.
   *
   * Optional because pre-claim paid messages don't yet have a thread.
   */
  threadId?: string;
  /**
   * `[senderId, recipientId].sort()`. Persisted on every message so the
   * thread query can use `where("participants", "array-contains", uid)`,
   * which is what lets Firestore's rule engine statically prove the
   * caller is allowed to read every result of the query.
   */
  participants: [string, string];
  senderId: string;
  senderHandle: string;
  senderDisplayName: string;
  senderAvatarUrl?: string;
  recipientId: string;
  recipientHandle: string;
  /** Sanitized rich-text HTML (Tiptap output). May contain inline images. */
  body: string;
  /** Plain-text projection of `body`, cached for previews and length checks. */
  bodyPlain?: string;
  amountUSD: number; // 0 for free messages
  chain?: Chain;
  token?: Token;
  /** Tx hash of the on-chain deposit (or, pre-escrow, the direct transfer). */
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  // ----------------- escrow fields (EVM only, optional for legacy direct-transfer rows) -----------------
  /** 32-byte hex paymentId used as the on-chain key. Required for claim/refund. */
  paymentId?: string;
  /** Address of the PayToChatEscrow contract that holds the deposit. */
  escrowAddress?: string;
  /** Numeric chainId of the chain that holds the escrow. */
  escrowChainId?: number;
  /** UNIX seconds. Sender can refund strictly after this. */
  escrowDeadline?: number;
  /** Tx hash of a successful claim by the recipient. */
  claimTxHash?: string;
  claimedAt?: Timestamp | number;
  /** Tx hash of a successful refund by the sender. */
  refundTxHash?: string;
  refundedAt?: Timestamp | number;
  // -------------------------------------------------------------------------------
  status: MessageStatus;
  createdAt: Timestamp | number;
  paidAt?: Timestamp | number;
  openedAt?: Timestamp | number;
}

export interface ConversationDoc {
  id: string; // sorted: `${minUid}_${maxUid}`
  participants: [string, string];
  participantHandles: [string, string];
  lastMessageAt: Timestamp | number;
  lastMessagePreview?: string;
  /**
   * @deprecated Replaced by `ThreadDoc.expiresAt`. Kept on the type so we
   * don't crash reading legacy docs, but the server no longer writes it
   * and the UI no longer consults it. The active reply window now lives
   * in the dedicated `threads/{convId}` doc, which is created on claim.
   */
  coolOffUntil?: Timestamp | number;
  unreadCount: { [uid: string]: number };
  /**
   * Total USD across **claimed** paid messages in this conversation.
   * Incremented atomically by the server on a successful on-chain claim
   * (so the recipient never learns the amount before they pull it).
   */
  totalPaidUSD: number;
}

export type ThreadStatus = "active" | "expired";

/**
 * A reply window that opens for `coolOffDays` (default 1 day) after
 * the recipient claims one specific paid message. Replies inside the
 * window are free; once `expiresAt` passes both sides need a fresh
 * paid message + claim to open another thread.
 *
 * Threads are **per paid message**: the doc id equals the anchor paid
 * message's id, so a single conversation between two users can have
 * multiple parallel/sequential threads — one per claimed paid message.
 * That's why the chats list shows one row per thread (the same sender
 * can appear multiple times) and each thread has its own URL.
 */
export interface ThreadDoc {
  /** Same as `anchorMessageId`. */
  id: string;
  /** The paid message that opened this thread (== `id`). */
  anchorMessageId: string;
  /** Conversation (`${minUid}_${maxUid}`) the thread lives inside, for grouping. */
  conversationId: string;
  participants: [string, string];
  participantHandles: [string, string];
  /** Tx hash of the on-chain claim that opened the thread. */
  anchorClaimTxHash?: string;
  /** Epoch ms of the claim. */
  startedAt: Timestamp | number;
  /** Epoch ms when this thread closes. `startedAt + coolOffDays * 24h`. */
  expiresAt: Timestamp | number;
  status: ThreadStatus;
  /** Number of free in-thread replies sent inside this window. */
  freeReplyCount: number;
  /** Most recent activity (anchor claim or free reply) for list ordering. */
  lastMessageAt: Timestamp | number;
  /** Plain-text preview of the most recent message in the thread. */
  lastMessagePreview?: string;
  /**
   * USD value the recipient actually received post-fee on claim. Only
   * set on the thread doc, which only exists post-claim, so it never
   * leaks an unclaimed amount.
   */
  anchorAmountUSD?: number;
}

export const DEFAULT_USER_SETTINGS: UserDoc["settings"] = {
  minThresholdUSD: 1,
  notifyThresholdUSD: 10,
  coolOffDays: 1,
  autoReplyTemplate:
    "Hey! I've moved DMs to Pay to Chat — drop me a message at https://paytochat.fun/{handle} and I'll read it. Even $1 puts you ahead of the spam queue.",
  acceptedChains: ["solana", "ethereum"],
  acceptedTokens: ["USDC", "USDT"],
  emailNotifications: true,
};
