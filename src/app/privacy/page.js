export const metadata = {
  title: "Privacy Policy | AgentZero",
  description: "Privacy Policy for AgentZero — how we collect, use, and protect your data.",
};

const LAST_UPDATED = "July 5, 2026";
const CONTACT_EMAIL = "shuayb@edusync.io";

const sections = [
  {
    title: "1. Introduction",
    body: `AgentZero ("we", "us", or "our") provides AI-powered tools for real estate professionals, including WhatsApp messaging, lead management, and voice automation. This Privacy Policy explains how we collect, use, disclose, and safeguard information when you use our website, applications, and related services (collectively, the "Service").

By using the Service, you agree to the collection and use of information in accordance with this policy.`,
  },
  {
    title: "2. Information We Collect",
    body: `We may collect the following types of information:

• Account and contact information — name, email address, phone number, company name, and login credentials you provide when signing up or connecting integrations.

• Communication data — WhatsApp messages, call transcripts, summaries, and related metadata processed through the Service on your behalf.

• Usage data — log files, IP address, browser type, device information, pages visited, and interaction patterns with the Service.

• Payment information — billing details processed by our payment provider (we do not store full card numbers on our servers).

• Integration data — information received from third-party platforms you connect (e.g. CRM exports, property listings, Meta WhatsApp Business accounts).`,
  },
  {
    title: "3. How We Use Your Information",
    body: `We use collected information to:

• Provide, operate, and maintain the Service
• Process transactions and send related communications
• Deliver AI-generated responses, summaries, and recommendations
• Improve and personalize the Service
• Monitor usage, detect fraud, and ensure security
• Comply with legal obligations
• Send service-related notices and, where permitted, product updates

We do not sell your personal information to third parties.`,
  },
  {
    title: "4. AI Processing",
    body: `The Service uses third-party AI providers to analyze conversations and generate responses. Content you submit may be processed by these providers solely to deliver the Service. We configure integrations to minimize unnecessary data retention by subprocessors, but their own privacy policies also apply.`,
  },
  {
    title: "5. Third-Party Services",
    body: `We rely on trusted third-party providers to operate the Service, which may include cloud hosting, databases, messaging platforms, payment processors, analytics, email delivery, and voice/telephony APIs. These providers process data only as needed to perform their functions and are contractually required to protect it.

When you connect external accounts (such as WhatsApp Business via Meta), their respective privacy policies govern data handled on those platforms.`,
  },
  {
    title: "6. Data Retention",
    body: `We retain personal information for as long as your account is active or as needed to provide the Service, comply with legal obligations, resolve disputes, and enforce agreements. You may request deletion of your data subject to applicable law and legitimate business needs (e.g. backup retention).`,
  },
  {
    title: "7. Security",
    body: `We implement reasonable administrative, technical, and organizational measures to protect your information, including encryption in transit, access controls, and secure credential storage. No method of transmission or storage is 100% secure; we cannot guarantee absolute security.`,
  },
  {
    title: "8. Your Rights",
    body: `Depending on your location, you may have rights to access, correct, delete, restrict, or port your personal data, and to object to certain processing. To exercise these rights, contact us using the details below or follow the data deletion instructions in Section 9. We will respond within the timeframe required by applicable law.`,
  },
  {
    title: "9. Data Deletion Requests",
    body: `You may request deletion of your personal data at any time. We provide the following options:

• Email request — send a message to ${CONTACT_EMAIL} with the subject "Data Deletion Request". Include your name, business name, and the WhatsApp number or email associated with your AgentZero account.

• Meta/Facebook removal — if you connected AgentZero through Facebook or WhatsApp Business, you can remove the app from Facebook Settings → Apps and Websites. Meta will notify us via our data deletion callback, and we will process the request automatically.

What we delete: account details, stored WhatsApp messages, lead and conversation records, integration tokens, and AI-generated summaries linked to your account.

Timeline: verified requests are processed within 30 days. Backup copies may take up to 90 days to purge. We may retain minimal information where required by law.

Status: if you removed the app via Meta, you will receive a confirmation code and can check status at /data-deletion on our website.`,
  },
  {
    title: "10. Cookies and Analytics",
    body: `We may use cookies and similar technologies to maintain sessions, remember preferences, and understand how the Service is used. You can control cookies through your browser settings. Disabling cookies may affect certain features.`,
  },
  {
    title: "11. International Transfers",
    body: `Your information may be processed in countries other than your own, including the United Arab Emirates, the United States, and the European Union, where our infrastructure and subprocessors operate. We take steps to ensure appropriate safeguards are in place for such transfers.`,
  },
  {
    title: "12. Children's Privacy",
    body: `The Service is not intended for individuals under 18. We do not knowingly collect personal information from children. If you believe we have collected data from a minor, please contact us and we will delete it promptly.`,
  },
  {
    title: "13. Changes to This Policy",
    body: `We may update this Privacy Policy from time to time. The "Last updated" date at the top will reflect the latest revision. Material changes will be communicated via the Service or email where appropriate. Continued use after changes constitutes acceptance.`,
  },
  {
    title: "14. Contact Us",
    body: `If you have questions about this Privacy Policy or our data practices, contact us at:

Email: ${CONTACT_EMAIL}`,
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12 border-b border-[var(--border)] pb-8">
        <p className="mb-2 text-sm text-[var(--muted)]">Last updated: {LAST_UPDATED}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-[var(--muted)]">
          AgentZero — AI assistant for real estate professionals.
        </p>
      </header>

      <article className="space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-3 text-lg font-medium">{section.title}</h2>
            <div className="whitespace-pre-line text-sm leading-relaxed text-[var(--muted)]">
              {section.body}
            </div>
          </section>
        ))}
      </article>

      <footer className="mt-16 border-t border-[var(--border)] pt-8 text-sm text-[var(--muted)]">
        <div className="flex flex-wrap gap-4">
          <a href="/data-deletion" className="hover:text-foreground transition-colors">
            Data deletion requests →
          </a>
          <a href="/" className="hover:text-foreground transition-colors">
            ← Back to home
          </a>
        </div>
      </footer>
    </main>
  );
}
