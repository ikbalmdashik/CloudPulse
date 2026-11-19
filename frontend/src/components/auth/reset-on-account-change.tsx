"use client";

import { useMe } from "@/hooks/use-auth";

/**
 * Gives `children` brand-new state whenever the signed-in account changes:
 * logging out (in this tab or another), or switching accounts.
 *
 * Next 16 keeps visited pages alive in the background (React Activity), so
 * without this the login and register forms would still hold the previous
 * person's input when someone returns to them after logging out. Changing the
 * key remounts the form: empty fields, no errors, no stale request status.
 *
 * (A remount is used instead of react-hook-form's `reset()`: with the React
 * Compiler on, `reset()` unregisters the inputs and the memoized JSX never
 * registers them again, so the form stops seeing what is typed.)
 */
export function ResetOnAccountChange({ children }: { children: React.ReactNode }) {
  const { data: user } = useMe();
  // `undefined` (still loading) and `null` (signed out) share a key, so the
  // form isn't remounted while someone is typing.
  return (
    <div key={user?.id ?? "signed-out"} className="contents">
      {children}
    </div>
  );
}
