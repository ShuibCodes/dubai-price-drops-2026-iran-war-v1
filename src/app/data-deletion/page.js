export const metadata = {
  title: "Data Deletion | AgentZero",
  description: "Request deletion of your AgentZero data or check the status of a deletion request.",
};

const CONTACT_EMAIL = "shuayb@edusync.io";

export default function DataDeletionPage({ searchParams }) {
  const code = searchParams?.code ? String(searchParams.code) : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12 border-b border-[var(--border)] pb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Data Deletion</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Request removal of personal data stored by AgentZero.
        </p>
      </header>

      {code ? (
        <section className="mb-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="mb-2 text-lg font-medium">Deletion request received</h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            Your request has been logged. We will delete associated account data,
            stored messages, lead records, and integration tokens within{" "}
            <strong className="text-foreground">30 days</strong>. Backup systems may
            retain copies for up to 90 days before automatic purge.
          </p>
          <p className="mt-4 font-mono text-sm text-foreground">Confirmation code: {code}</p>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Save this code for your records. Questions? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      ) : null}

      <article className="space-y-8 text-sm leading-relaxed text-[var(--muted)]">
        <section>
          <h2 className="mb-3 text-lg font-medium text-foreground">
            How to request deletion
          </h2>
          <p className="mb-3">You can delete your data in either of these ways:</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong className="text-foreground">Email us</strong> at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-foreground underline">
                {CONTACT_EMAIL}
              </a>{" "}
              with the subject line &quot;Data Deletion Request&quot;. Include your name,
              business name, and the WhatsApp or email address linked to your account.
            </li>
            <li>
              <strong className="text-foreground">Remove via Meta/Facebook</strong> — if you
              connected through Facebook, go to Facebook Settings → Apps and Websites, remove
              AgentZero, and we will receive an automated deletion request.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium text-foreground">What we delete</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account and agent profile information</li>
            <li>WhatsApp message history stored by AgentZero</li>
            <li>Lead and conversation records</li>
            <li>Connected integration tokens (Meta, CRM, etc.)</li>
            <li>Call transcripts and AI-generated summaries tied to your account</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium text-foreground">Timeline</h2>
          <p>
            We process verified deletion requests within 30 days. Residual backup copies
            are purged within 90 days. We may retain minimal records where required by law
            (e.g. billing or fraud prevention).
          </p>
        </section>
      </article>

      <footer className="mt-16 border-t border-[var(--border)] pt-8 text-sm text-[var(--muted)]">
        <a href="/privacy" className="hover:text-foreground transition-colors">
          ← Privacy Policy
        </a>
      </footer>
    </main>
  );
}
