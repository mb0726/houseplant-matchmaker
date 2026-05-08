/**
 * Houseplant Matchmaker - Spinner Verbs
 *
 * Rotating "thinking" verbs shown while the agent is processing.
 * Themed around plant care, kitchen, whimsical/absurd, and plant puns.
 *
 * Cycle every ~1500ms while isThinking is true.
 * Avoid repeating the same verb back-to-back when picking randomly.
 */

export const SPINNER_VERBS: string[] = [
    // Plant care / botanical
    "Rooting around",
    "Cross-pollinating ideas",
    "Photosynthesizing options",
    "Pruning the list",
    "Repotting suggestions",
    "Sniffing out matches",
    "Sprouting recommendations",
    "Checking the soil",
    "Watering ideas",
    "Picking the bouquet",
    "Tending the trellis",
    "Composting bad ideas",
    "Foraging for matches",
    "Greenhouse-ing",
  
    // Kitchen / cooking
    "Simmering thoughts",
    "Letting it steep",
    "Whisking ideas",
  
    // Whimsical / absurd - committee + bureaucracy energy
    "Holding a leaf summit",
    "Calling a meeting of the monsteras",
    "Filing paperwork with the philodendrons",
    "Awaiting orchid approval",
    "Convening the cacti council",
    "Polling the pothos",
    "Forming a fern coalition",
    "Submitting a request to the succulents",
    "Drafting a leaf manifesto",
  
    // Whimsical / absurd - mystical + oracle energy
    "Reading the tea leaves",
    "Translating from plant",
    "Asking the bonsai",
    "Decoding root signals",
    "Listening to the leaves",
    "Receiving fern transmissions",
    "Channeling chlorophyll wisdom",
    "Tuning into the trellis",
    "Decoding the leaf script",
  
    // Whimsical / absurd - quirky personality
    "Phoning a fern",
    "Whispering to roots",
    "Brewing something good",
    "Squinting at the sunlight",
    "Wandering through the garden",
    "Getting lost in the foliage",
    "Picking petals",
    "Wading through the weeds",
    "Botanizing",
    "Daydreaming in chlorophyll",
    "Vibing with the verdant",
    "Plotting a green plot",
    "Negotiating with the ferns",
  
    // Plant puns - thinking + reasoning
    "Sowing some ideas",
    "Going out on a limb",
    "Branching out",
    "Putting down roots",
    "Getting to the root of it",
    "Digging in",
    "Turning over a new leaf",
    "Beating around the bush",
    "Going against the grain",
    "Cultivating an answer",
    "Letting ideas blossom",
    "Watching ideas bloom",
    "Stalking an answer",
    "Shooting up some ideas",
  
    // Plant puns - plant action + care
    "Leafing through options",
    "Sprouting an answer",
    "Budding ideas",
    "Spreading like ivy",
    "Climbing the trellis of logic",
    "Repotting the question",
    "Pruning the possibilities",
    "Trimming the fat",
    "Weeding out the bad ones",
    "Trellising the options",
  
    // Plant puns - more absurd
    "Going to seed",
    "Reaching for the light",
    "Bending toward the sun",
    "Combing through the canopy",
    "Forking the path",
    "Untangling the vines",
    "Following the vine",
    "Thinking outside the pot",
  ];
  
  /**
   * Pick a random verb that hasn't appeared yet in this turn.
   *
   * Pass the array of verbs already shown — the picker excludes all of them.
   * If somehow every verb has been used (extremely long turn), it cycles back
   * by clearing history but still avoids repeating the most recent one.
   */
  export function pickSpinnerVerb(used: readonly string[] = []): string {
    if (SPINNER_VERBS.length === 0) return "Thinking";

    const usedSet = new Set(used);
    let candidates = SPINNER_VERBS.filter((v) => !usedSet.has(v));

    if (candidates.length === 0) {
      const last = used[used.length - 1];
      candidates = SPINNER_VERBS.filter((v) => v !== last);
      if (candidates.length === 0) return SPINNER_VERBS[0]!;
    }

    return candidates[Math.floor(Math.random() * candidates.length)]!;
  }