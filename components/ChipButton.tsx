'use client';

type Props = {
  text: string;
  onClick: () => void;
  disabled?: boolean;
};

export function ChipButton({ text, onClick, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-full border border-[#b85c3c] bg-white text-sm text-stone-800 transition hover:bg-[#fdf3ef] hover:border-[#a0492d] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {text}
    </button>
  );
}
