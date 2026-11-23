/**
 * Ordering the discovery feed: best fit first, predictable ties, no long
 * runs of near-identical people, and pages that never repeat anyone.
 *
 * Plain module, so it can be tested directly.
 */

export type Rankable = {
  id: string;
  /** 0-1 from the compatibility engine (already adjusted for missing data). */
  rankScore: number;
  /** ISO time of the candidate's last profile update. */
  lastActive: string;
  /** Candidates with the same key look alike in the feed (e.g. same flat society). */
  clusterKey: string;
};

/** How close two scores must be before variety may reorder them. */
export const DIVERSITY_TOLERANCE = 0.05;
/** At most this many in a row with the same cluster key, when avoidable. */
export const MAX_RUN = 2;

const rounded = (value: number) => Math.round(value * 10000) / 10000;

/** Highest score first; ties by most recently active, then by id. */
export function byRank(a: Rankable, b: Rankable): number {
  return (
    rounded(b.rankScore) - rounded(a.rankScore) ||
    (b.lastActive > a.lastActive ? 1 : b.lastActive < a.lastActive ? -1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Sort by rank, then break up runs: when the next candidate would make a
 * run longer than MAX_RUN of the same kind, the next different candidate
 * within DIVERSITY_TOLERANCE of its score goes first instead. Deterministic.
 */
export function rankCandidates<T extends Rankable>(items: readonly T[]): T[] {
  const remaining = [...items].sort(byRank);
  const out: T[] = [];
  while (remaining.length > 0) {
    let index = 0;
    const tail = out.slice(-MAX_RUN);
    const wouldRun = tail.length === MAX_RUN && tail.every((item) => item.clusterKey === remaining[0].clusterKey);
    if (wouldRun) {
      const alternative = remaining.findIndex(
        (item) =>
          item.clusterKey !== remaining[0].clusterKey &&
          rounded(remaining[0].rankScore) - rounded(item.rankScore) <= DIVERSITY_TOLERANCE,
      );
      if (alternative > 0) {
        index = alternative;
      }
    }
    out.push(remaining.splice(index, 1)[0]);
  }
  return out;
}

/**
 * The next page: the first `size` ranked candidates not already shown.
 * `hasMore` says whether anyone is left after this page.
 */
export function nextPage<T extends { id: string }>(
  ranked: readonly T[],
  shown: Iterable<string>,
  size: number,
): { page: T[]; hasMore: boolean } {
  const skip = new Set(shown);
  const fresh: T[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (!skip.has(item.id) && !seen.has(item.id)) {
      seen.add(item.id);
      fresh.push(item);
    }
  }
  return { page: fresh.slice(0, size), hasMore: fresh.length > size };
}
