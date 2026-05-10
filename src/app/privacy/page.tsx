import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarketingNav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Privacy Policy — Pay to Chat",
  description:
    "How Pay to Chat handles the data it needs to deliver paid messages: account info, wallet addresses, message content, on-chain transactions, and email notifications.",
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "May 10, 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <MarketingNav />
      <article className="mx-auto max-w-3xl px-4 py-10 md:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground mb-6"
        >
          <ArrowLeft size={14} /> Back home
        </Link>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-muted">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          <Section title="1. The short version">
            <p>
              We collect the minimum we need to run the Service: an email or
              Google identity to log you in, a public handle and display name,
              wallet addresses you choose to publish, and the messages you
              send or receive. We do not sell personal data, we do not show
              ads, and we are non-custodial — your funds never touch our
              servers. The amount and content of paid messages stay hidden in
              the inbox until you reveal them, and our email notifications
              never leak either.
            </p>
          </Section>

          <Section title="2. Who runs the Service">
            <p>
              Pay to Chat is operated by the team behind paytochat.fun. For
              data-protection requests, write to{" "}
              <a href="mailto:privacy@paytochat.fun">privacy@paytochat.fun</a>.
            </p>
          </Section>

          <Section title="3. Data we collect">
            <h3>Account data</h3>
            <ul>
              <li><strong>Authentication identifier</strong> — email + password hash, or your Google account ID — handled by Firebase Auth.</li>
              <li><strong>Public profile</strong> — handle, display name, optional bio, optional avatar URL, and optional links (X / Instagram / website).</li>
              <li><strong>Settings</strong> — minimum tip threshold, notify-above threshold, cool-off length, accepted chains and tokens, email-notifications toggle, auto-reply template.</li>
              <li><strong>Wallet addresses</strong> — Ethereum and/or Solana addresses you publish to receive tips. These are public on-chain identifiers.</li>
            </ul>
            <h3>Message data</h3>
            <ul>
              <li>Sanitized message body (HTML), a plain-text projection used for previews, and any inline images you attach.</li>
              <li>On-chain references for paid messages: transaction hash, chain, token, sender address, recipient address, verified amount.</li>
              <li>Status and timestamps: created, paid, opened.</li>
            </ul>
            <h3>Conversation data</h3>
            <ul>
              <li>Participant pair, last-message timestamp, unread counts, the running cool-off window, and the cumulative paid total in that thread.</li>
            </ul>
            <h3>Operational data</h3>
            <ul>
              <li>Server logs (e.g. failed payment-verification attempts, send / open errors). These contain user IDs, IP addresses, and request metadata, and we retain them up to 30 days for abuse prevention.</li>
              <li>Email-delivery metadata from SendGrid (bounces, deferrals) for paid-message notifications you have opted into.</li>
            </ul>
            <p>
              We do <strong>not</strong> use marketing cookies or third-party
              ad / analytics trackers. We rely on first-party authentication
              cookies set by Firebase and the standard cookies your wallet
              connector (RainbowKit, Solana Wallet Adapter) uses to remember
              your last connection.
            </p>
          </Section>

          <Section title="4. What we do with it">
            <ul>
              <li><strong>Run the Service</strong> — render your public profile, route messages, verify on-chain payments, send the configured email notifications, enforce abuse limits.</li>
              <li><strong>Email notifications</strong> — when a paid message lands above your &ldquo;notify above&rdquo; threshold, we send a minimal email through SendGrid. The email never contains the message body or the tip amount; it only links you to the inbox so you can reveal both there. You can disable email notifications in Settings.</li>
              <li><strong>Security & fraud prevention</strong> — detecting duplicate transaction hashes, flagging suspicious senders, blocking spam.</li>
              <li><strong>Legal compliance</strong> — responding to lawful requests, sanctions screening, audit trails for the messaging platform.</li>
            </ul>
            <p>
              We do not use your data to train machine-learning models. We do
              not sell or rent personal data. We do not target ads.
            </p>
          </Section>

          <Section title="5. Lawful basis (GDPR / UK GDPR)">
            <ul>
              <li><strong>Contract</strong> — to deliver the Service you signed up for (account, messaging, payment verification).</li>
              <li><strong>Legitimate interest</strong> — keeping the Service secure and free of abuse, debugging.</li>
              <li><strong>Consent</strong> — email notifications when enabled, optional analytics if we ever introduce them.</li>
              <li><strong>Legal obligation</strong> — sanctions / law-enforcement compliance.</li>
            </ul>
          </Section>

          <Section title="6. On-chain disclosure">
            <p>
              Stablecoin transfers happen on public blockchains (Solana
              mainnet and Ethereum mainnet). The sender wallet, recipient
              wallet, token, amount, and timing are <strong>publicly
              visible</strong> on those chains and are not controlled by us.
              When you publish a wallet address on your profile, anyone can
              correlate it with on-chain activity. Use a fresh address if you
              want to keep your tip activity separate from your other on-chain
              identity.
            </p>
          </Section>

          <Section title="7. Where data lives">
            <ul>
              <li><strong>Firebase Authentication, Firestore, and Cloud Storage</strong> — operated by Google. Data is stored in the Firebase project&apos;s configured region.</li>
              <li><strong>Vercel</strong> — hosts the Next.js front end and serverless API routes. Logs may transit Vercel&apos;s infrastructure (default region us-east-1).</li>
              <li><strong>SendGrid (Twilio)</strong> — outbound transactional email for paid-message notifications.</li>
              <li><strong>Public RPC providers</strong> — used to read transaction status from Solana and Ethereum. Requests carry the transaction hash but no user identity.</li>
              <li><strong>WalletConnect Cloud</strong> — relays wallet pairings; the WalletConnect project ID is public.</li>
            </ul>
            <p>
              These providers act as data processors. By using the Service you
              consent to your data being processed in their infrastructure,
              including transfers to the United States or other regions where
              they operate. Where required, we rely on Standard Contractual
              Clauses for cross-border transfers.
            </p>
          </Section>

          <Section title="8. Retention">
            <ul>
              <li>Account profile and messages persist until you delete the account.</li>
              <li>Server logs: up to 30 days unless extended by an active investigation.</li>
              <li>Email-delivery metadata: up to 30 days at SendGrid.</li>
              <li>On-chain transaction data is permanent on the underlying blockchains and outside our control.</li>
            </ul>
          </Section>

          <Section title="9. Your rights">
            <p>
              Depending on where you live, you have rights to access, rectify,
              delete, restrict, port, or object to processing of your personal
              data. To exercise any of these, email{" "}
              <a href="mailto:privacy@paytochat.fun">privacy@paytochat.fun</a>{" "}
              from the address on your account. We will respond within 30 days.
            </p>
            <p>
              You also have the right to lodge a complaint with your local
              data-protection authority (e.g. the ICO in the UK, your DPA in
              the EU).
            </p>
          </Section>

          <Section title="10. Children">
            <p>
              The Service is not intended for anyone under 18. We do not
              knowingly collect data from children. If you believe a child has
              created an account, contact us and we will remove it.
            </p>
          </Section>

          <Section title="11. Security">
            <p>
              We use Firebase&apos;s security rules to deny client writes to
              messages and lock conversation updates to a single field
              (<code>unreadCount</code>). API routes verify Firebase ID tokens
              and on-chain transactions before persisting anything. Inline
              images are sanitized server-side before storage. We don&apos;t
              custody funds, so even a server compromise can&apos;t move your
              stablecoins.
            </p>
            <p>
              Despite all this, no system is perfectly secure. If you suspect
              your account has been accessed without your permission, change
              your password, sign out of all sessions, and email{" "}
              <a href="mailto:security@paytochat.fun">security@paytochat.fun</a>.
            </p>
          </Section>

          <Section title="12. Changes">
            <p>
              We may update this policy. Material changes will be reflected by
              updating the &ldquo;Last updated&rdquo; date above and, where
              feasible, by notifying signed-in users in-app.
            </p>
          </Section>
        </div>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xl md:text-2xl font-semibold tracking-tight mb-3">
        {title}
      </h2>
      <div className="space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_a]:text-brand-300 [&_a]:hover:underline [&_code]:rounded [&_code]:bg-white/5 [&_code]:border [&_code]:border-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]">
        {children}
      </div>
    </section>
  );
}
