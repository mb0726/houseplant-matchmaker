'use client';

import { ChipButton } from './ChipButton';

// Locked copy. Do not modify without explicit approval — verbatim per spec.
const WELCOME_TEXT =
  "Hey! I'm your plant sidekick — here to play matchmaker and find the right plant for your lifestyle. What kind of plant person are you?";

const CHIPS = [
  '🌱 Plant newbie',
  '💀 Serial plant killer (oops)',
  '🪴 Getting the hang of it',
  '🌿 Confident plant parent',
];

type Props = {
  onChipClick: (text: string) => void;
  disabled?: boolean;
};

export function WelcomeMessage({ onChipClick, disabled }: Props) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <p className="text-stone-700 leading-relaxed">{WELCOME_TEXT}</p>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <ChipButton
            key={c}
            text={c}
            onClick={() => onChipClick(c)}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
