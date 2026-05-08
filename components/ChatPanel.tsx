'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WelcomeMessage } from './WelcomeMessage';
import { PlantCard } from './PlantCard';
import { ChipButton } from './ChipButton';
import type { Plant } from '@/lib/types';
import { pickSpinnerVerb } from '@/lib/spinnerVerbs';

// The agent emits GitHub-flavored markdown (bold, italics, bullets, tables,
// horizontal rules) as a deliberate way of structuring richer responses.
// We render it through react-markdown with remark-gfm and our own component
// overrides so it picks up the existing chat typography (no @tailwindcss/
// typography dependency, no global prose styles to fight).
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="text-stone-800 leading-relaxed">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-stone-900">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="list-disc pl-6 space-y-1 text-stone-800">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 space-y-1 text-stone-800">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-4 border-stone-200" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-stone-200 pl-4 italic text-stone-600">
      {children}
    </blockquote>
  ),
  // GFM tables for compare-style outputs.
  table: ({ children }) => (
    <table className="border-collapse text-sm my-2">{children}</table>
  ),
  thead: ({ children }) => <thead className="bg-stone-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-stone-200 px-3 py-1.5 text-left font-medium text-stone-700">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-stone-200 px-3 py-1.5 align-top text-stone-800">
      {children}
    </td>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 bg-stone-100 rounded text-[0.85em] font-mono text-stone-700">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

// What the chat panel renders for each turn. The page owns the API messages
// (Anthropic.MessageParam[]) separately for round-tripping; the UI just needs
// the human-readable shape plus per-turn chip suggestions.
export type UIMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; cards: Plant[]; chips: string[] };

type Props = {
  messages: UIMessage[];
  isThinking: boolean;
  // Drives the input field's disabled state. Distinct from isThinking so a
  // cap-hit can lock input even after the spinner has gone away.
  inputDisabled?: boolean;
  onSend: (text: string) => void;
};

// Card markers are emitted by the agent as `{{card:plant_id}}` on (typically)
// their own line. We split the prose at each marker so cards render inline at
// the position the agent intended.
const CARD_MARKER = /\{\{card:([a-z0-9_]+)\}\}/g;
const CARD_MARKER_FULL = /^\{\{card:([a-z0-9_]+)\}\}$/;

function AssistantMessage({ text, cards }: { text: string; cards: Plant[] }) {
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  // Split keeps capture groups, so parts alternate between text and the marker
  // string itself. We re-test each part to know which is which.
  const parts = text.split(CARD_MARKER);
  // After split with capture group, parts looks like:
  //   [text0, id1, text1, id2, text2, ...]
  // Even indices are text, odd indices are captured plant ids.
  const usedIds = new Set<string>();
  const nodes: ReactNode[] = [];

  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // Plant id from a marker.
      const plant = cardsById.get(part);
      if (plant) {
        usedIds.add(plant.id);
        nodes.push(<PlantCard key={`card-${i}`} plant={plant} />);
      }
      // Unknown id → skip silently. Better than rendering broken text.
      return;
    }
    const trimmed = part.trim();
    if (!trimmed) return;
    // Each text segment between markers gets its own markdown render. Spacing
    // BETWEEN segments comes from the parent's space-y; spacing WITHIN a
    // segment (between paragraphs, lists, etc.) is handled by the components
    // map above with a wrapper div applying space-y for vertical rhythm.
    nodes.push(
      <div key={`text-${i}`} className="space-y-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {trimmed}
        </ReactMarkdown>
      </div>,
    );
  });

  // Fallback: agent fetched plants but didn't place any markers. Render the
  // unmarked cards at the end so they don't go missing entirely.
  const orphans = cards.filter((c) => !usedIds.has(c.id));
  if (usedIds.size === 0 && orphans.length > 0) {
    nodes.push(
      <div key="orphan-cards" className="flex flex-col gap-3">
        {orphans.map((p) => (
          <PlantCard key={p.id} plant={p} />
        ))}
      </div>,
    );
  }

  return <div className="space-y-4 max-w-2xl">{nodes}</div>;
}

function ChipsRow({
  chips,
  onChipClick,
  disabled,
}: {
  chips: string[];
  onChipClick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 max-w-2xl">
      {chips.map((c, i) => (
        <ChipButton
          key={`${i}:${c}`}
          text={c}
          onClick={() => onChipClick(c)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// Rotates through themed verbs while mounted. Mounting/unmounting is driven
// by isThinking in the parent, so the interval lifecycle is handled by React's
// effect cleanup — when the response arrives and isThinking flips false, this
// component unmounts and the interval clears. The used-verbs history also
// resets on unmount, so each new turn gets a fresh no-repeat sequence.
const SPINNER_INTERVAL_MS = 2500;
function ThinkingIndicator() {
  const [used, setUsed] = useState<string[]>(() => [pickSpinnerVerb([])]);
  const verb = used[used.length - 1]!;
  useEffect(() => {
    const interval = setInterval(() => {
      setUsed((prev) => [...prev, pickSpinnerVerb(prev)]);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
  return <div className="text-stone-400 italic">{verb}…</div>;
}

// Pixels of breathing room above the assistant message's top border when we
// anchor the viewport. Falls in the 16-20px range — enough that the divider
// reads as "start of turn" rather than being flush against the chrome.
const ANCHOR_OFFSET_PX = 18;

export function ChatPanel({ messages, isThinking, inputDisabled, onSend }: Props) {
  const inputLocked = inputDisabled ?? isThinking;
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // Points at the latest assistant message div. Re-attached every render
  // because lastAssistantIdx moves as new turns arrive.
  const latestAssistantRef = useRef<HTMLDivElement>(null);
  // Whether the user manually scrolled during the current thinking phase.
  // If true, we don't yank them around when the response lands — they may
  // be reviewing earlier turns. Reset at the start of each new turn.
  const userScrolledRef = useRef(false);
  // Tracks the previous isThinking value so we can detect transitions.
  const prevIsThinkingRef = useRef(isThinking);

  // Mark the user as having scrolled when we see real input events (wheel,
  // touch, keyboard). Programmatic scrolls don't fire these, so we won't
  // mistake our own smooth-scroll animations for user intent.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onUserScroll = () => {
      userScrolledRef.current = true;
    };
    el.addEventListener('wheel', onUserScroll, { passive: true });
    el.addEventListener('touchmove', onUserScroll, { passive: true });
    el.addEventListener('keydown', onUserScroll);
    return () => {
      el.removeEventListener('wheel', onUserScroll);
      el.removeEventListener('touchmove', onUserScroll);
      el.removeEventListener('keydown', onUserScroll);
    };
  }, []);

  // Scroll behavior:
  //   - new turn starts (isThinking false → true): reset the user-scroll
  //     flag and scroll to bottom so the user's own message is in view
  //   - response lands (isThinking true → false): anchor the viewport to
  //     the top of the new assistant message, with breathing room above —
  //     unless the user manually scrolled mid-turn, in which case respect
  //     their position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wasThinking = prevIsThinkingRef.current;
    prevIsThinkingRef.current = isThinking;

    if (!wasThinking && isThinking) {
      userScrolledRef.current = false;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      return;
    }

    if (wasThinking && !isThinking) {
      if (userScrolledRef.current) return;
      const target = latestAssistantRef.current;
      if (!target) return;
      const containerTop = el.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      const offset = el.scrollTop + (targetTop - containerTop) - ANCHOR_OFFSET_PX;
      el.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    }
  }, [messages, isThinking]);

  function submit() {
    const text = draft.trim();
    if (!text || inputLocked) return;
    onSend(text);
    setDraft('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleChip(text: string) {
    if (inputLocked) return;
    onSend(text);
  }

  // Find the index of the last assistant message — that's where chips render.
  // Older assistant turns' chips are intentionally hidden so the UI doesn't
  // accumulate stale buttons over a long conversation.
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  // First assistant turn skips the top divider so we don't get a stray line
  // at the very start of the conversation. Subsequent assistant turns get a
  // subtle border that anchors where each new turn begins (helpful after
  // auto-scroll lands the user mid-message).
  let firstAssistantIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === 'assistant') {
      firstAssistantIdx = i;
      break;
    }
  }

  return (
    <section className="flex flex-col h-full bg-white">
      <header className="px-6 py-4 border-b border-stone-200">
        <h1 className="text-lg font-semibold text-stone-900">🌱 Houseplant Matchmaker</h1>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <WelcomeMessage onChipClick={handleChip} disabled={inputLocked} />
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="px-4 py-2 rounded-2xl bg-stone-900 text-white max-w-xl">
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            );
          }
          const isLatest = i === lastAssistantIdx;
          const isFirst = i === firstAssistantIdx;
          // Center the divider inside the parent's space-y-6 (24px) gap:
          // -mt-3 + pt-3 net out to the same 24px, with the 1px border in
          // the middle. Visual gap above + below the line is unchanged.
          const dividerCls = isFirst
            ? ''
            : '-mt-3 pt-3 border-t border-stone-200';
          return (
            <div
              key={i}
              ref={isLatest ? latestAssistantRef : null}
              className={`space-y-4 ${dividerCls}`}
            >
              <AssistantMessage text={m.text} cards={m.cards} />
              {isLatest && !isThinking && m.chips.length > 0 && (
                <ChipsRow chips={m.chips} onChipClick={handleChip} disabled={inputLocked} />
              )}
            </div>
          );
        })}

        {isThinking && <ThinkingIndicator />}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-stone-200 p-4 flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Tell me about your space…"
          disabled={inputLocked}
          rows={1}
          className="flex-1 resize-none px-4 py-2 rounded-xl border border-stone-300 focus:outline-none focus:border-stone-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={inputLocked || !draft.trim()}
          className="px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-medium transition hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </section>
  );
}
