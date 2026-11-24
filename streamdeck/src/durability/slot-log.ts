/**
 * Follows whether the slot table holds fresh data, to log the change once instead of on every frame:
 * one line when the data is lost (stall, expiry or grid lost) and one when it is back. Nothing is
 * logged while no specific-item key is visible; the state then just follows the data silently.
 */
export function trackSlots(fresh: boolean, hasData: boolean, watching: boolean): { fresh: boolean; message?: string } {
  if (hasData === fresh) return { fresh };
  if (!watching) return { fresh: hasData };
  return {
    fresh: hasData,
    message: hasData ? "slot data available" : "slot data lost (stalled, expired or grid lost)",
  };
}
