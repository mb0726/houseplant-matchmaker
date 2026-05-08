'use client';

// State owner for the chat. Holds two parallel views of the conversation:
//   uiMessages — what the chat panel renders (user text + assistant text + cards)
//   apiMessages — the canonical Anthropic.MessageParam[] sent back next turn
// Trace and usage accumulate across the session; observability panel reads them.

import { useEffect, useState } from 'react';
import { ChatPanel, type UIMessage } from '@/components/ChatPanel';
import { ObservabilityPanel } from '@/components/ObservabilityPanel';
import { CAP_MESSAGE, SESSION_MESSAGE_CAP } from '@/lib/cap-messages';
import type { TraceEntry, AgentUsage, Plant } from '@/lib/types';

type ChatApiSuccess = {
  ok: true;
  data: {
    response: string;
    trace: TraceEntry[];
    cards: Plant[];
    suggested_chips: string[];
    usage: AgentUsage;
    messages: unknown[]; // Anthropic.MessageParam[] — opaque to the client
    stop_reason: string;
    // Set when a guardrail trips server-side. Drives the disabled input state.
    cap_hit?: 'daily' | 'monthly' | 'rate_limit';
  };
};
type ChatApiError = { ok: false; error: string };
type ChatApiResponse = ChatApiSuccess | ChatApiError;

const ZERO_USAGE: AgentUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

export default function Home() {
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([]);
  const [apiMessages, setApiMessages] = useState<unknown[]>([]);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [usage, setUsage] = useState<AgentUsage>(ZERO_USAGE);
  const [isThinking, setIsThinking] = useState(false);
  // Once a guardrail trips, the input field locks and stays locked for the
  // rest of the page lifetime. User must refresh to start a new session.
  const [capHit, setCapHit] = useState<'daily' | 'monthly' | 'rate_limit' | 'session' | null>(null);
  // Demo override: if the page was loaded with ?demo_key=…, that value is
  // appended to every /api/chat request so the server bypasses per-IP rate
  // limits (but NOT budget caps). Read once on mount.
  const [demoKey, setDemoKey] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDemoKey(params.get('demo_key'));
  }, []);

  async function handleSend(text: string) {
    if (isThinking || capHit) return;

    // Layer 2: client-side session cap. Counted from user messages so the
    // user gets exactly SESSION_MESSAGE_CAP full turns; the (cap+1)th send
    // attempt renders the cap copy without ever touching the network.
    const userMessageCount = uiMessages.filter((m) => m.role === 'user').length;
    if (userMessageCount >= SESSION_MESSAGE_CAP) {
      // Mimic the real-turn rhythm so the existing scroll-anchor logic in
      // ChatPanel runs: setIsThinking(true) scrolls the user's typed message
      // to the bottom; the brief delay flashes the spinner so the cap landing
      // doesn't feel abrupt; setIsThinking(false) anchors the cap message to
      // the top of the viewport just like a normal completion.
      setIsThinking(true);
      setUiMessages((prev) => [...prev, { role: 'user', text }]);
      await new Promise((r) => setTimeout(r, 400));
      setUiMessages((prev) => [
        ...prev,
        { role: 'assistant', text: CAP_MESSAGE.session, cards: [], chips: [] },
      ]);
      setIsThinking(false);
      setCapHit('session');
      return;
    }

    setIsThinking(true);
    setUiMessages((prev) => [...prev, { role: 'user', text }]);

    try {
      const url = demoKey
        ? `/api/chat?demo_key=${encodeURIComponent(demoKey)}`
        : '/api/chat';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, message: text }),
      });
      const json = (await res.json()) as ChatApiResponse;

      if (!json.ok) {
        setUiMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `Sorry — ${json.error}`, cards: [], chips: [] },
        ]);
        return;
      }

      const result = json.data;
      setUiMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: result.response,
          cards: result.cards,
          chips: result.suggested_chips ?? [],
        },
      ]);
      setApiMessages(result.messages);
      setTrace((prev) => [...prev, ...result.trace]);
      setUsage((prev) => ({
        input_tokens: prev.input_tokens + result.usage.input_tokens,
        output_tokens: prev.output_tokens + result.usage.output_tokens,
        cache_creation_input_tokens:
          prev.cache_creation_input_tokens + result.usage.cache_creation_input_tokens,
        cache_read_input_tokens:
          prev.cache_read_input_tokens + result.usage.cache_read_input_tokens,
      }));
      // Server flagged a cap — lock the input. The cap copy is already in
      // result.response and rendered as part of the assistant turn above.
      if (result.cap_hit) setCapHit(result.cap_hit);
    } catch (e) {
      setUiMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `Network error: ${(e as Error).message}`,
          cards: [],
          chips: [],
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <main className="flex flex-col md:flex-row h-screen overflow-hidden">
      <div className="flex-[3] min-h-0 overflow-hidden md:border-r border-b md:border-b-0 border-stone-200">
        <ChatPanel
          messages={uiMessages}
          isThinking={isThinking}
          inputDisabled={isThinking || capHit !== null}
          onSend={handleSend}
        />
      </div>
      <div className="flex-[2] min-h-0 overflow-hidden">
        <ObservabilityPanel trace={trace} usage={usage} />
      </div>
    </main>
  );
}
