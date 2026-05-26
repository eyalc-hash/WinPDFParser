import { useEffect, useRef, useState } from "react";
import type { AgentAnswer, AgentCitation } from "@shared/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface ChatTurn {
  id: number;
  question: string;
  /** ``null`` while the answer is in flight. */
  answer: AgentAnswer | null;
  error: string | null;
}

export function Agent(): JSX.Element {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-scroll the transcript to the latest turn so the user always sees
    // the answer that just came back.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const id = nextIdRef.current++;
    const pending: ChatTurn = { id, question: trimmed, answer: null, error: null };
    setTurns((prev) => [...prev, pending]);
    setQuestion("");
    setLoading(true);
    try {
      const answer = await window.api.sidecar.agent.ask(trimmed);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, answer } : t)));
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, error: (err as Error).message ?? "Request failed" } : t,
        ),
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3">
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          turns.map((turn) => <Turn key={turn.id} turn={turn} />)
        )}
      </div>
      <form
        onSubmit={onSubmit}
        className="flex gap-2 border-t border-border px-4 py-3"
        aria-label="Ask the agent a question"
      >
        <Input
          ref={inputRef}
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your indexed PDFs…"
          aria-label="Agent question"
          disabled={loading}
        />
        <Button variant="primary" type="submit" disabled={loading || !question.trim()}>
          {loading ? "…" : "Ask"}
        </Button>
      </form>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl py-8 text-sm text-muted-foreground">
      <h2 className="mb-2 text-base font-medium text-foreground">Ask the Agent</h2>
      <p className="mb-2">
        The Agent uses your local search index together with the on-device model
        configured in Settings to answer questions about your indexed PDFs.
      </p>
      <p>
        Try something like <em>“What is the total on the Acme invoice?”</em> or
        <em> “Summarize the consulting contract.”</em>
      </p>
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }): JSX.Element {
  return (
    <article className="mb-4 rounded-md border border-border bg-card/40 p-3">
      <header className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">You</header>
      <p className="mb-3 text-sm">{turn.question}</p>
      <header className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Agent</header>
      {turn.error ? (
        <p className="text-sm text-destructive">{turn.error}</p>
      ) : turn.answer ? (
        <AnswerBody answer={turn.answer} />
      ) : (
        <p className="text-sm text-muted-foreground">Thinking…</p>
      )}
    </article>
  );
}

function AnswerBody({ answer }: { answer: AgentAnswer }): JSX.Element {
  return (
    <div>
      {!answer.model_available ? (
        <p
          role="status"
          className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200"
        >
          The local model is unavailable. Showing matching passages without an
          LLM-generated summary. Check Ollama in Settings.
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
      {answer.queries.length > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Searched: {answer.queries.map((q) => `“${q}”`).join(", ")}
        </p>
      ) : null}
      {answer.citations.length > 0 ? (
        <section className="mt-3" aria-label="Citations">
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
            Citations ({answer.citations.length})
          </h4>
          <ul className="space-y-2">
            {answer.citations.map((c) => (
              <li key={c.document_id}>
                <Citation citation={c} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No passages matched.</p>
      )}
    </div>
  );
}

function Citation({ citation }: { citation: AgentCitation }): JSX.Element {
  const title = citation.ai_name ?? citation.original_name;
  return (
    <div className="rounded border border-border bg-background/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{title}</span>
        <div className="flex gap-1">
          {citation.output_path ? (
            <Button
              variant="ghost"
              onClick={() => window.api.openPath(citation.output_path!)}
              aria-label={`Open ${title}`}
            >
              Open
            </Button>
          ) : null}
          {citation.output_path ? (
            <Button
              variant="ghost"
              onClick={() => window.api.revealInFolder(citation.output_path!)}
              aria-label={`Reveal ${title} in folder`}
            >
              Reveal
            </Button>
          ) : null}
        </div>
      </div>
      {citation.ai_name && citation.ai_name !== citation.original_name ? (
        <p className="text-[11px] text-muted-foreground">{citation.original_name}</p>
      ) : null}
      <p className="mt-1 text-xs leading-relaxed text-foreground/90">{citation.passage}</p>
    </div>
  );
}
