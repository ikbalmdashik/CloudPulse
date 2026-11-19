"use client";

import { ArrowRightIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { useMe } from "@/hooks/use-auth";

/**
 * On /login and /register while a session exists: say who is signed in and
 * offer to continue, instead of silently sending the visitor to that account.
 * Logging in below switches this browser (every tab) to the new account.
 */
export function SignedInNotice() {
  const { data: user } = useMe();
  if (!user) return null;
  return (
    <Alert className="w-full max-w-sm">
      <UserRoundIcon />
      <AlertTitle>You&apos;re signed in as {user.fullName}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {user.email}. To use a different account, log in below; this browser will switch to it in every
          tab.
        </p>
        <Link href="/" className={buttonVariants({ size: "sm" })}>
          Continue as {user.fullName.split(/\s+/)[0]} <ArrowRightIcon />
        </Link>
      </AlertDescription>
    </Alert>
  );
}
