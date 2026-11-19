"use client";

import { ChevronRightIcon, Loader2Icon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { RoleBadge } from "@/components/role-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type SavedAccount, useForgetAccount, useMe, useSavedAccounts, useSwitchAccount } from "@/hooks/use-auth";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/**
 * On /login and /register: the accounts saved in this browser, most recently
 * used first. Choosing one continues without a password (its saved session is
 * used). The form below the list adds another account.
 */
export function AccountChooser() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: accounts } = useSavedAccounts();
  const { data: me } = useMe();
  const switchAccount = useSwitchAccount();
  const forget = useForgetAccount();

  if (!accounts?.length) return null;

  const choose = (a: SavedAccount) => {
    if (a.active) return router.replace("/");
    switchAccount.mutate(a.id, {
      onSuccess: () => router.replace("/"),
      onError: () => toast.error(`${a.fullName}'s session has ended. Log in again below.`),
    });
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Choose an account</CardTitle>
        <CardDescription>
          Signed in on this browser. {pathname === "/register" ? "Or create a new account below." : "Or log in with another account below."}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <ul className="space-y-1">
          {accounts.map((a, i) => {
            const pending = switchAccount.isPending && switchAccount.variables === a.id;
            // The first account is the default: the one the app opens with.
            // "Signed in" while it's in use here; after a logout it's "Last used".
            const label = i === 0 ? (me?.id === a.id ? "Signed in" : "Last used") : null;
            return (
              <li key={a.id} className="group relative">
                <button
                  type="button"
                  onClick={() => choose(a)}
                  disabled={switchAccount.isPending}
                  className="flex w-full items-center gap-3 rounded-lg p-2 pr-10 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                >
                  <Avatar className="size-9">
                    <AvatarFallback className="text-xs">{initials(a.fullName)}</AvatarFallback>
                  </Avatar>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{a.fullName}</span>
                      {label && (
                        <Badge variant="secondary" className="shrink-0">
                          {label}
                        </Badge>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="truncate text-xs text-muted-foreground">{a.email}</span>
                      <RoleBadge role={a.role} />
                    </span>
                  </span>
                  {pending ? (
                    <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  )}
                </button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() =>
                          forget.mutate(a.id, { onSuccess: () => toast.success(`${a.fullName} removed from this browser`) })
                        }
                        disabled={forget.isPending}
                        className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
                        aria-label={`Remove ${a.fullName} from this browser`}
                      />
                    }
                  >
                    <XIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>Log out and remove from this browser</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
