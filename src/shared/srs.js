// Spaced repetition: a compact SM-2 variant (the algorithm behind classic Anki).
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const GRADES = Object.freeze({ again: 0, hard: 3, good: 4, easy: 5 });

export function newCard(now = Date.now()) {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now, lastReview: null };
}

/**
 * Apply a review. `grade` is 0..5 (use GRADES). Returns a new card object.
 * - grade < 3: the card lapses and comes back in 10 minutes.
 * - otherwise the interval grows: 1 day, 6 days, then interval × ease.
 */
export function review(card, grade, now = Date.now()) {
  const c = { ...newCard(now), ...card };
  const q = Math.max(0, Math.min(5, grade));

  if (q < 3) {
    return {
      ...c,
      reps: 0,
      lapses: c.lapses + 1,
      interval: 0,
      ease: Math.max(1.3, c.ease - 0.2),
      due: now + 10 * MINUTE,
      lastReview: now
    };
  }

  const ease = Math.max(1.3, c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let interval;
  if (c.reps === 0) interval = q === 5 ? 4 : 1;
  else if (c.reps === 1) interval = q === 3 ? 3 : q === 5 ? 8 : 6;
  else {
    const factor = q === 3 ? 1.2 : q === 5 ? c.ease * 1.3 : c.ease;
    interval = Math.max(c.interval + 1, Math.round(c.interval * factor));
  }

  return { ...c, ease, interval, reps: c.reps + 1, due: now + interval * DAY, lastReview: now };
}

export function isDue(card, now = Date.now()) {
  return !card || card.due <= now;
}

/** Human-readable "next interval" for each answer button. */
export function previewIntervals(card, now = Date.now()) {
  const out = {};
  for (const [name, grade] of Object.entries(GRADES)) {
    out[name] = formatDelay(review(card, grade, now).due - now);
  }
  return out;
}

export function formatDelay(ms) {
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY - 30 * MINUTE) return `${Math.round(ms / (60 * MINUTE))}h`;
  const days = Math.round(ms / DAY);
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
