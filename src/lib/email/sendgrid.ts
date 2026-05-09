import "server-only";
import sgMail from "@sendgrid/mail";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return false;
  sgMail.setApiKey(apiKey);
  configured = true;
  return true;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://paytochat.fun"
  ).replace(/\/$/, "");
}

export interface NewMessageEmailInput {
  toEmail: string;
  recipientHandle: string;
  recipientDisplayName?: string;
  senderHandle: string;
  senderDisplayName?: string;
}

/**
 * Send a "you got paid" notification via SendGrid. Intentionally minimal —
 * no message body, no tip amount, no preview. The whole point of Pay to
 * Chat is that the amount stays hidden until the recipient reveals it in
 * the inbox; leaking either through email would defeat that. Best-effort:
 * returns `false` (and logs) on misconfig or API errors so callers can
 * fire-and-forget.
 */
export async function sendNewMessageEmail(
  input: NewMessageEmailInput
): Promise<boolean> {
  if (!configure()) {
    console.warn(
      "[sendgrid] SENDGRID_API_KEY missing; skipping new-message email"
    );
    return false;
  }

  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!fromEmail) {
    console.warn(
      "[sendgrid] SENDGRID_FROM_EMAIL missing; skipping new-message email"
    );
    return false;
  }
  const fromName = process.env.SENDGRID_FROM_NAME || "Pay to Chat";

  const senderName = input.senderDisplayName || input.senderHandle;
  const recipientName = input.recipientDisplayName || input.recipientHandle;
  const inboxUrl = `${appUrl()}/a/dashboard`;
  const settingsUrl = `${appUrl()}/a/dashboard/settings`;

  const subject = `You got a paid message from @${input.senderHandle}`;

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e7e7ee;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b10;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#13131c;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;">Pay to Chat</p>
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#ffffff;">
                  Hey ${escapeHtml(recipientName)}, you got paid.
                </h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.5;color:#d1d5db;">
                  <strong style="color:#ffffff;">${escapeHtml(senderName)}</strong>
                  (<a href="${appUrl()}/${encodeURIComponent(input.senderHandle)}" style="color:#a78bfa;text-decoration:none;">@${escapeHtml(input.senderHandle)}</a>)
                  just sent you a paid message. Open your inbox to see how much
                  it's worth and read what they wrote.
                </p>
                <p style="margin:0 0 24px 0;">
                  <a href="${inboxUrl}" style="display:inline-block;background:linear-gradient(135deg,#a78bfa,#f472b6);color:#0b0b10;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:12px;font-size:14px;">Open inbox</a>
                </p>
                <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">
                  You're getting this because email notifications are on.
                  <a href="${settingsUrl}" style="color:#9ca3af;">Turn them off in settings</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  const text = [
    `Hey ${recipientName},`,
    "",
    `@${input.senderHandle} (${senderName}) just sent you a paid message.`,
    "Open your inbox to see how much it's worth and read what they wrote:",
    inboxUrl,
    "",
    `Turn off email notifications: ${settingsUrl}`,
  ].join("\n");

  try {
    await sgMail.send({
      to: input.toEmail,
      from: { email: fromEmail, name: fromName },
      subject,
      text,
      html,
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
        openTracking: { enable: false },
      },
      mailSettings: { sandboxMode: { enable: false } },
    });
    return true;
  } catch (err) {
    console.error("[sendgrid] new-message email failed", err);
    return false;
  }
}
