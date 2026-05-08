// User-facing copy shown when a guardrail trips. Each message renders as a
// final assistant turn in the chat (same styling, same border-t divider) and
// the input field is disabled afterwards.
//
// Rendered through react-markdown via ChatPanel, so markdown links work.
// Keep these in the agent's plant-sidekick voice — never default to a generic
// "rate limit exceeded" string.

// Layer 2 — client-side session message cap. The cap value is hardcoded into
// the session copy below ("I cap each session at 20 messages") so update both
// in lockstep if this number changes.
export const SESSION_MESSAGE_CAP = 20;

export const CAP_MESSAGE = {
  daily:
    "Looks like the plant sidekick has been busy today! 🌿 This is a portfolio demo with a daily budget cap, and we've hit it. Come back tomorrow and I'll be ready to chat again.",

  monthly:
    "The plant matchmaking machine needs a rest 🪴 We've hit this month's demo budget. If you're a recruiter or hiring manager who'd like to see more, reach me at [linkedin.com/in/monabrahmbhatt](https://linkedin.com/in/monabrahmbhatt) — happy to share a walkthrough.",

  rate_limit:
    "Whoa, you're moving fast! 🌱 I cap each visitor at ~20 questions per hour to keep this demo affordable. Take a quick break and come back in a bit — I'll still be here.",

  session:
    "We've covered a lot of ground in this conversation! 🌱 To keep things snappy, I cap each session at 20 messages. Refresh to start a fresh chat — I won't remember the previous one, but I'll be ready to help you find the right plant from scratch.",
} as const;

export type CapHit = keyof typeof CAP_MESSAGE;
