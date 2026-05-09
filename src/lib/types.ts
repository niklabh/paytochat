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
  | "paid" // tx confirmed, awaiting recipient open
  | "opened" // recipient revealed
  | "rejected" // below recipient threshold
  | "free"; // free reply sent during the cool-off window

export interface MessageDoc {
  id: string;
  conversationId: string;
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
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
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
   * Until this timestamp either participant can send a free reply in the
   * thread. Set on each paid open (`now + coolOffDays`) and re-extended by
   * every subsequent paid open.
   */
  coolOffUntil?: Timestamp | number;
  unreadCount: { [uid: string]: number };
  totalPaidUSD: number;
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
