"use client";

import { LayoutDashboardIcon, LogOutIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { RoleBadge } from "@/components/role-badge";
import { ThemeMenuItems } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout, useMe } from "@/hooks/use-auth";
import type { Role, SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon, roles: ["ADMIN"] },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function Nav({ user, className }: { user: SessionUser; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex items-center gap-1", className)} aria-label="Main">
      {NAV.filter((i) => !i.roles || i.roles.includes(user.role)).map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const logout = useLogout();
  const onLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        toast.success("You have been logged out");
        router.replace("/login");
      },
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-9 gap-2 px-2" aria-label={`Account menu for ${user.fullName}`} />
        }
      >
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{initials(user.fullName)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 truncate text-sm sm:inline">{user.fullName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
            <span className="truncate font-medium text-foreground">{user.fullName}</span>
            <span className="truncate text-xs">{user.email}</span>
            <span>
              <RoleBadge role={user.role} />
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} disabled={logout.isPending}>
          <LogOutIcon /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Layout for signed-in pages. Sends logged-out visitors to /login. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    if (me.data === null) router.replace("/login");
  }, [me.data, router]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="shrink-0">
            <Brand />
          </Link>
          {me.data && <Nav user={me.data} className="hidden md:flex" />}
          <div className="ml-auto">
            {me.data ? <UserMenu user={me.data} /> : <Skeleton className="h-8 w-28" />}
          </div>
        </div>
        {me.data && (
          <div className="border-t px-2 py-1 md:hidden">
            <Nav user={me.data} />
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:py-8">
        {me.isError ? (
          <div className="rounded-lg border border-destructive/40 p-6 text-sm">
            <p className="font-medium">Couldn&apos;t load your account.</p>
            <p className="mt-1 text-muted-foreground">{me.error.message}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => me.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          // Always render the page so Next can prerender its shell; each page
          // shows its own loading state until the user is known.
          children
        )}
      </main>
    </div>
  );
}
