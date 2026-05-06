export default function UploadProgress() {
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-[var(--border)] border-dashed bg-[var(--surface)]/80 p-6">
        <h3 className="text-base font-medium text-[var(--foreground)]">
          WhatsApp Export Upload
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Upload a WhatsApp chat export to attach conversations to your
          knowledge base. Not available in this build.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--muted)] cursor-not-allowed"
        >
          Upload (coming soon)
        </button>
      </div>
      <div className="rounded-xl border border-[var(--border)] border-dashed bg-[var(--surface)]/80 p-6">
        <h3 className="text-base font-medium text-[var(--foreground)]">
          Gmail Connect
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Connect Gmail to sync relevant threads. OAuth is not wired up yet.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--muted)] cursor-not-allowed"
        >
          Connect Gmail (coming soon)
        </button>
      </div>
    </section>
  );
}
