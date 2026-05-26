import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Props {
  onClose: () => void;
}

export function FeedbackDialog({ onClose }: Props): JSX.Element {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; issueUrl?: string; error?: string } | null>(null);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await window.api.submitFeedback({
        title: title.trim(),
        body: body.trim(),
        contact: contact.trim() || undefined,
      });
      setResult(res);
    } catch (err) {
      setResult({ success: false, error: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-lg">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Send feedback</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>

        {result?.success ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-emerald-400">
              Thank you for your feedback! Your submission has been received.
            </p>
            {result.issueUrl ? (
              <p className="text-xs text-muted-foreground">
                You can track it at{" "}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => window.api.openPath(result.issueUrl!)}
                >
                  {result.issueUrl}
                </button>
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button variant="primary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Have a suggestion or feature request?               We&apos;d love to hear from you.
            </p>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Title <span className="text-destructive">*</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short summary of your feedback"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Description <span className="text-destructive">*</span>
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your suggestion or feature request in detail…"
                disabled={submitting}
                rows={5}
                className={
                  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm " +
                  "placeholder:text-muted-foreground focus:border-primary focus:outline-none " +
                  "resize-none disabled:cursor-not-allowed disabled:opacity-50"
                }
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Contact (optional)
              </label>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="GitHub username or email — in case we need to follow up"
                disabled={submitting}
              />
            </div>

            {result?.error ? (
              <p className="text-xs text-destructive">{result.error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
                {submitting ? "Submitting…" : "Submit feedback"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
