export type RotationCandidate = {
  id: string;
  active: boolean;
  lastAssignedAt: Date | null;
};

/**
 * Picks the active seller who waited longest since their last lead.
 * Someone who never received a lead goes first. Stateless: the only state is
 * each person's lastAssignedAt, so a new seller joins the rotation naturally.
 */
export function pickNextOwner(candidates: RotationCandidate[]): string | null {
  const active = candidates.filter((c) => c.active);
  if (active.length === 0) return null;

  const sorted = [...active].sort((a, b) => {
    const aTime = a.lastAssignedAt?.getTime() ?? -Infinity;
    const bTime = b.lastAssignedAt?.getTime() ?? -Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });

  return sorted[0]?.id ?? null;
}
