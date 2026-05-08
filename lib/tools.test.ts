// Basic unit tests for the four tools. Uses Node's built-in test runner.
//
// Run: npm test
//   (which runs `node --import tsx --test lib/*.test.ts`)
//
// Tests assume lib/plants.json is the v1 dataset (100 plants). They reference
// known plant ids by name; if the dataset changes meaningfully these may need
// to be updated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filter_plants,
  get_plant_details,
  compare_plants,
  explain_failure_modes,
} from './tools.ts';

// =============================================================================
// filter_plants
// =============================================================================

test('filter_plants: low-light + cat (canonical interaction #1)', () => {
  const res = filter_plants({
    hard_constraints: { pet_safe: 'yes', light: ['low', 'medium'] },
    limit: 5,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // Every match must satisfy both hard constraints.
  for (const m of res.data.matches) {
    const detail = get_plant_details({ plant_id: m.plant_id });
    assert.equal(detail.ok, true);
    if (!detail.ok) continue;
    const p = detail.data.plant;
    assert.equal(p.pet_safe, 'yes', `${p.id} should be pet_safe`);
    assert.ok(['low', 'medium'].includes(p.light), `${p.id} should be low/medium light`);
  }
  assert.ok(res.data.matches.length > 0, 'should have at least one match');
  assert.ok(res.data.total_matches >= res.data.matches.length);
  // Reasons should include the pet-safe and light callouts.
  const top = res.data.matches[0]!;
  assert.ok(top.reasons.some((r) => r.includes('pet-safe')));
  assert.ok(top.reasons.some((r) => r.includes('light')));
});

test('filter_plants: pet_safe=yes surfaces unknown-safety plants separately', () => {
  const res = filter_plants({ hard_constraints: { pet_safe: 'yes' }, limit: 100 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // 11 plants in the dataset have pet_safe=unknown; all should appear in the
  // separate bucket (none in matches).
  assert.ok(
    res.data.unknown_safety_excluded.length > 0,
    'should surface unknown-safety plants',
  );
  for (const m of res.data.matches) {
    const p = get_plant_details({ plant_id: m.plant_id });
    if (p.ok) assert.equal(p.data.plant.pet_safe, 'yes');
  }
});

test('filter_plants: preference scoring boosts vibe matches', () => {
  // Find a plant with 'sculptural' vibe to confirm scoring lifts it above
  // a generic plant on the same hard constraints.
  const withVibe = filter_plants({
    preferences: { vibe: ['sculptural'] },
    limit: 5,
  });
  const noPref = filter_plants({ limit: 100 });
  assert.equal(withVibe.ok, true);
  assert.equal(noPref.ok, true);
  if (!withVibe.ok || !noPref.ok) return;

  // Top match with vibe preference should outrank its no-preference position.
  const topId = withVibe.data.matches[0]!.plant_id;
  const topScoreNow = withVibe.data.matches[0]!.fit_score;
  const baseScoreEntry = noPref.data.matches.find((m) => m.plant_id === topId);
  assert.ok(baseScoreEntry, 'top vibe match should also exist in unfiltered set');
  assert.ok(
    topScoreNow > baseScoreEntry.fit_score,
    `score with vibe preference (${topScoreNow}) should exceed base (${baseScoreEntry.fit_score})`,
  );
});

test('filter_plants: exclude_ids removes specified plants from results', () => {
  const all = filter_plants({ limit: 100 });
  assert.equal(all.ok, true);
  if (!all.ok) return;
  const firstId = all.data.matches[0]!.plant_id;
  const excluded = filter_plants({ exclude_ids: [firstId], limit: 100 });
  assert.equal(excluded.ok, true);
  if (!excluded.ok) return;
  for (const m of excluded.data.matches) {
    assert.notEqual(m.plant_id, firstId);
  }
});

test('filter_plants: empty result when constraints exclude everything', () => {
  // No fern is a succulent.
  const res = filter_plants({
    hard_constraints: { category: ['fern'], water: ['low'] },
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.matches.length, 0);
  assert.equal(res.data.total_matches, 0);
});

test('filter_plants: name_query finds plant when user appends "plant"', () => {
  // The lipstick failure: dataset common_name is "Lipstick" but users type
  // "lipstick plant". The fuzzy match must strip "plant" as a stopword.
  const res = filter_plants({ name_query: 'lipstick plant', limit: 5 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(
    res.data.matches.some((m) => m.plant_id === 'lipstick'),
    'should match lipstick when query is "lipstick plant"',
  );
});

test('filter_plants: name_query finds plant via scientific name', () => {
  // Monstera should be findable by its genus.
  const res = filter_plants({ name_query: 'Monstera deliciosa', limit: 5 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.data.matches.some((m) => m.plant_id === 'monstera'));
});

test('filter_plants: name_query is case- and punctuation-insensitive', () => {
  const res = filter_plants({ name_query: 'SNAKE PLANT!!!', limit: 5 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(res.data.matches.some((m) => m.plant_id === 'snake_plant'));
});

test('filter_plants: name_query returns empty when plant truly absent', () => {
  const res = filter_plants({ name_query: 'venus flytrap', limit: 5 });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.matches.length, 0);
});

test('filter_plants: name_query combines with hard_constraints', () => {
  // Searching pothos varieties limited to bright light.
  const res = filter_plants({
    name_query: 'pothos',
    hard_constraints: { light: ['bright'] },
    limit: 10,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  for (const m of res.data.matches) {
    const detail = get_plant_details({ plant_id: m.plant_id });
    if (detail.ok) assert.equal(detail.data.plant.light, 'bright');
  }
});

test('filter_plants: results sorted by fit_score desc', () => {
  const res = filter_plants({
    preferences: { vibe: ['sculptural', 'lush'], best_for: ['beginners'] },
    limit: 20,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  for (let i = 1; i < res.data.matches.length; i++) {
    assert.ok(
      res.data.matches[i - 1]!.fit_score >= res.data.matches[i]!.fit_score,
      'matches should be sorted descending by fit_score',
    );
  }
});

// =============================================================================
// get_plant_details
// =============================================================================

test('get_plant_details: known plant returns full record', () => {
  const res = get_plant_details({ plant_id: 'spider_plant' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.plant.id, 'spider_plant');
  assert.equal(res.data.plant.scientific_name, 'Chlorophytum comosum');
  assert.ok(res.data.plant.short_description.length > 20);
});

test('get_plant_details: unknown id returns error', () => {
  const res = get_plant_details({ plant_id: 'definitely_not_a_plant' });
  assert.equal(res.ok, false);
  if (res.ok) return;
  // Error string should mention the missing id so the agent can surface it.
  assert.match(res.error, /definitely_not_a_plant/);
});

// =============================================================================
// compare_plants
// =============================================================================

test('compare_plants: 2 valid ids returns plants in order', () => {
  const res = compare_plants({ plant_ids: ['spider_plant', 'monstera'] });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.plants.length, 2);
  assert.equal(res.data.plants[0]!.id, 'spider_plant');
  assert.equal(res.data.plants[1]!.id, 'monstera');
  // Dimensions row should exist for every compared dimension.
  assert.ok(res.data.dimensions.find((d) => d.field === 'pet_safe'));
});

test('compare_plants: 3 valid ids works', () => {
  const res = compare_plants({
    plant_ids: ['spider_plant', 'monstera', 'snake_plant'],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.plants.length, 3);
});

test('compare_plants: 1 id is rejected', () => {
  const res = compare_plants({ plant_ids: ['spider_plant'] });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /2 or 3/);
});

test('compare_plants: 4 ids is rejected', () => {
  const res = compare_plants({
    plant_ids: ['spider_plant', 'monstera', 'snake_plant', 'jade_plant'],
  });
  assert.equal(res.ok, false);
});

test('compare_plants: unknown id is reported in error', () => {
  const res = compare_plants({
    plant_ids: ['spider_plant', 'definitely_not_a_plant'],
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /definitely_not_a_plant/);
});

// =============================================================================
// explain_failure_modes
// =============================================================================

test('explain_failure_modes: valid plant returns failure modes', () => {
  const res = explain_failure_modes({ plant_id: 'monstera' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.plant_id, 'monstera');
  assert.ok(res.data.failure_modes.length > 0);
  assert.equal(res.data.contextual_warnings.length, 0);
});

test('explain_failure_modes: situation triggers contextual warning for high-water plant', () => {
  // Boston fern is high-water; "I forget to water" should fire the rule.
  const res = explain_failure_modes({
    plant_id: 'boston_fern',
    user_situation: 'I travel a lot and forget to water plants',
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(
    res.data.contextual_warnings.some((w) => w.includes('consistent moisture')),
    'should fire forget-to-water warning for high-water plant',
  );
});

test('explain_failure_modes: pet keyword triggers warning for toxic plant', () => {
  // Monstera is pet_safe=no.
  const res = explain_failure_modes({
    plant_id: 'monstera',
    user_situation: 'I have a cat that chews everything',
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(
    res.data.contextual_warnings.some((w) => w.includes('toxic to pets')),
    'should warn about pet toxicity',
  );
});

test('explain_failure_modes: unknown plant errors', () => {
  const res = explain_failure_modes({ plant_id: 'definitely_not_a_plant' });
  assert.equal(res.ok, false);
});
