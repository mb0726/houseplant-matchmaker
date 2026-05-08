'use client';

import type { Plant } from '@/lib/types';

// Display labels for enum values. Per the locked spec we NEVER render raw
// enum values to users — always go through these maps.
const DIFFICULTY_LABEL: Record<Plant['difficulty'], string> = {
  easy: 'Easy care',
  medium: 'Some experience',
  expert: 'Expert',
};

const LIGHT_LABEL: Record<Plant['light'], string> = {
  low: 'Low light',
  medium: 'Medium light',
  bright: 'Bright indirect',
  direct: 'Direct sun',
};

const WATER_LABEL: Record<Plant['water'], string> = {
  low: 'Low water',
  moderate: 'Moderate water',
  high: 'Wants moisture',
};

// Pet-safety language is locked per spec:
//   yes      → short tag "Pet-safe" (long form "Safe for cats and dogs" available if needed)
//   no       → short tag "Toxic to pets"
//   unknown  → "Toxicity unknown — check with a vet before bringing home" (long form only)
function petSafetyTag(p: Plant): { text: string; tone: 'safe' | 'toxic' | 'unknown' } {
  if (p.pet_safe === 'yes') return { text: 'Pet-safe', tone: 'safe' };
  if (p.pet_safe === 'no') return { text: 'Toxic to pets', tone: 'toxic' };
  return { text: 'Toxicity unknown', tone: 'unknown' };
}

type Props = { plant: Plant };

export function PlantCard({ plant }: Props) {
  const safety = petSafetyTag(plant);
  return (
    <div className="flex gap-4 p-4 rounded-2xl border border-stone-200 bg-white">
      {plant.image_url ? (
        // External Wikimedia URLs — using <img> rather than next/image to skip
        // remote-pattern config and image proxy overhead for v1.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={plant.image_url}
          alt={plant.common_name}
          className="w-32 h-32 rounded-xl object-cover flex-shrink-0 bg-stone-100"
        />
      ) : (
        <div className="w-32 h-32 rounded-xl bg-stone-100 flex-shrink-0" />
      )}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <div>
          <h3 className="font-semibold text-stone-900 leading-tight">{plant.common_name}</h3>
          <p className="text-sm italic text-stone-500">{plant.scientific_name}</p>
        </div>
        <div className="text-xs text-stone-600 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>{DIFFICULTY_LABEL[plant.difficulty]}</span>
          <span className="text-stone-300">·</span>
          <span>{LIGHT_LABEL[plant.light]}</span>
          <span className="text-stone-300">·</span>
          <span>{WATER_LABEL[plant.water]}</span>
          <span className="text-stone-300">·</span>
          <span
            className={
              safety.tone === 'safe'
                ? 'text-emerald-700 font-medium'
                : safety.tone === 'toxic'
                  ? 'text-rose-700 font-medium'
                  : 'text-amber-700 font-medium'
            }
          >
            {safety.text}
          </span>
        </div>
        {plant.pet_safe === 'unknown' && (
          <p className="text-xs text-amber-700 italic">
            Check with a vet before bringing home.
          </p>
        )}
        <p className="text-sm text-stone-700 leading-relaxed">{plant.short_description}</p>
        {plant.image_attribution && (
          <p className="text-[10px] text-stone-400 mt-auto pt-1">{plant.image_attribution}</p>
        )}
      </div>
    </div>
  );
}
