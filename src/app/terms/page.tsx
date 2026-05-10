import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarketingNav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Terms of Service — Pay to Chat",
  description:
    "The terms that govern how you use paytochat.fun, including payment, on-chain transfers, message ownership, and account termination.",
  alternates: { canonical: "/terms" },
};

const LAST_UPDATED = "May 10, 2026";

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-muted">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          <Section title="1. What Pay to Chat is">
            <p>
              Pay to Chat (&ldquo;<strong>Pay to Chat</strong>,&rdquo;
              &ldquo;<strong>we</strong>,&rdquo; or
              &ldquo;<strong>the Service</strong>&rdquo;) is a web app at
              paytochat.fun that lets a sender attach a USDC or USDT stablecoin
              tip to a written message and deliver that message to a recipient
              who has claimed a public handle on the Service. The recipient
              decides whether to read it.
            </p>
            <p>
              By creating an account, claiming a handle, or sending a message
              through Pay to Chat, you agree to these Terms. If you don&apos;t
              agree, don&apos;t use the Service.
            </p>
          </Section>

          <Section title="2. Eligibility">
            <ul>
              <li>You must be at least 18 years old (or the age of majority where you live).</li>
              <li>You must be legally allowed to send and receive stablecoin transfers in your jurisdiction.</li>
              <li>You may not use the Service if you are subject to OFAC sanctions, are on a U.S. or EU sanctions list, or are located in a sanctioned jurisdiction.</li>
            </ul>
          </Section>

          <Section title="3. Accounts and handles">
            <p>
              You sign in via Firebase Authentication (email + password or
              Google). On first sign-in you pick a public <em>handle</em>{" "}
              (3-24 lowercase alphanumeric characters or underscores), which
              becomes your URL at <code>paytochat.fun/&lt;handle&gt;</code>.
            </p>
            <ul>
              <li>You are responsible for safeguarding your sign-in credentials.</li>
              <li>Handles are first-come, first-served and may not be sold, rented, or transferred outside the Service.</li>
              <li>We may reclaim handles that impersonate real people, infringe trademarks, target abuse, or have been inactive for an extended period.</li>
              <li>You may delete your account at any time by emailing the address in section 13. Deletion removes your profile and ends future deliveries to you; messages already on-chain cannot be reversed.</li>
            </ul>
          </Section>

          <Section title="4. Payments and stablecoin transfers">
            <p>
              Pay to Chat is <strong>non-custodial</strong>. Senders transfer
              USDC or USDT directly from their own wallet to the recipient&apos;s
              wallet on Solana mainnet or Ethereum mainnet. We never hold,
              touch, or have signing authority over user funds.
            </p>
            <ul>
              <li>You are solely responsible for the wallet you connect, the address you send to, and the network you choose. <strong>On-chain transfers are irreversible.</strong></li>
              <li>Network fees (gas / priority fees) are paid by the sender to the underlying blockchain, not to us.</li>
              <li>The Service verifies a transaction&apos;s recipient, token contract / SPL mint, and amount before unlocking the message. A message that fails verification will not be delivered, but the on-chain transfer itself cannot be undone by us.</li>
              <li>USDC and USDT are issued by third parties (Circle and Tether). Their issuer terms, including freeze and blacklist powers, apply to balances independent of the Service.</li>
              <li>Stablecoin tips are <strong>not refundable through the Service</strong>. If a recipient chooses not to read a message, the tip stays with the recipient. Disputes are between the sender and recipient.</li>
            </ul>
          </Section>

          <Section title="5. Messages and content">
            <p>
              You retain ownership of the messages you send. By submitting a
              message you grant us a non-exclusive, worldwide, royalty-free
              license to store, transmit, sanitize, and display it strictly to
              operate the Service for you and the intended recipient.
            </p>
            <p>You may not send content that:</p>
            <ul>
              <li>Is illegal, infringing, defamatory, or harassing.</li>
              <li>Contains malware, phishing payloads, or solicits unauthorized financial activity.</li>
              <li>Sexually exploits or endangers minors.</li>
              <li>Violates privacy or surveillance laws applicable to either party.</li>
            </ul>
            <p>
              Inline images uploaded to Firebase Storage are your responsibility;
              we cap each upload at 8 MB and accept common image MIME types only.
              We reserve the right to remove content and terminate accounts that
              breach these rules, with or without notice.
            </p>
          </Section>

          <Section title="6. Cool-off replies">
            <p>
              When a paid message is opened by the recipient, both parties may
              reply free in the thread for the cool-off window the recipient
              configures (default 24 hours). Each new paid message resets the
              window. Once the window expires, free replies are rejected and a
              fresh paid message is required to reopen the thread. There is no
              permanent free-chat flag.
            </p>
          </Section>

          <Section title="7. No financial advice; not a money service">
            <p>
              The Service is a messaging application. We are not a broker,
              dealer, exchange, money transmitter, or investment adviser. We do
              not provide financial advice, custody, market-making, or
              fiat-to-crypto conversion. Use of stablecoins through Pay to Chat
              is a peer-to-peer transfer between users.
            </p>
          </Section>

          <Section title="8. Disclaimers">
            <p className="uppercase tracking-wide text-xs text-muted">
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, non-infringement, and any warranty arising out of course of dealing or usage of trade.
            </p>
            <p>
              We don&apos;t warrant that the Service will be uninterrupted,
              secure, error-free, free of harmful components, or compatible
              with any blockchain&apos;s availability or finality. Public RPC
              endpoints, the Solana / Ethereum networks, Firebase, Vercel,
              SendGrid, and other third-party providers occasionally
              degrade or fail; we have no control over those events.
            </p>
          </Section>

          <Section title="9. Limitation of liability">
            <p className="uppercase tracking-wide text-xs text-muted">
              To the fullest extent permitted by law, Pay to Chat and its
              operators will not be liable for any indirect, incidental,
              special, consequential, exemplary, or punitive damages, or for
              loss of profits, revenue, data, goodwill, or on-chain assets,
              arising out of or in connection with the Service.
            </p>
            <p>
              Our aggregate liability for any claim relating to the Service is
              limited to USD 100 or the total fees you have paid to us in the
              12 months preceding the claim, whichever is greater. Today we
              charge no platform fees, so this cap will typically be USD 100.
            </p>
          </Section>

          <Section title="10. Indemnity">
            <p>
              You agree to indemnify and hold us harmless from any claim,
              demand, loss, or expense (including reasonable legal fees)
              arising out of (a) your use of the Service, (b) your messages or
              wallets, (c) your violation of these Terms, or (d) your
              violation of any law or third-party right.
            </p>
          </Section>

          <Section title="11. Termination">
            <p>
              We may suspend or terminate your account at any time, with or
              without notice, if we reasonably believe you have breached these
              Terms or applicable law, or to comply with a legal request. You
              may stop using the Service at any time.
            </p>
          </Section>

          <Section title="12. Changes">
            <p>
              We may update these Terms. Material changes will be reflected by
              updating the &ldquo;Last updated&rdquo; date above and, where
              feasible, notifying signed-in users in-app. Continued use after
              the update means you accept the revised Terms.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              Questions, takedowns, or account requests:{" "}
              <a
                href="mailto:hello@paytochat.fun"
                className="text-brand-300 hover:underline"
              >
                hello@paytochat.fun
              </a>
              . For community discussion, see{" "}
              <a
                href="https://t.me/paytochat"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-300 hover:underline"
              >
                @paytochat on Telegram
              </a>
              .
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
      <div className="space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-brand-300 [&_a]:hover:underline [&_code]:rounded [&_code]:bg-white/5 [&_code]:border [&_code]:border-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]">
        {children}
      </div>
    </section>
  );
}
