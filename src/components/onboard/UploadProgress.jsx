import WhatsAppUploader from "./WhatsAppUploader";

export default function UploadProgress({ agents = [] }) {
  return (
    <div className="grid gap-4">
      <header>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">
          Knowledge Base
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload WhatsApp exports to build your knowledge base. Additional
          sources will appear here as they roll out.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        <WhatsAppUploader agents={agents} />
        <div className="rounded-xl border border-[var(--border)] border-dashed bg-[var(--surface)]/80 p-6">
          <h3 className="text-base font-medium text-[var(--foreground)]">
            Gmail Connect
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Connect Gmail to sync relevant threads. Coming soon in Feature 3 —
            OAuth is not wired up yet.
          </p>
          <button
            type="button"
            disabled
            className="mt-4 w-full cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--muted)]"
          >
            Connect Gmail (coming soon)
          </button>
        </div>
      </section>
    </div>
  );
}
