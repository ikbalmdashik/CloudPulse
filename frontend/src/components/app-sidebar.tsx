"use client";

import {
  ActivityIcon,
  ChevronsUpDownIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PlusCircleIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense } from "react";
import { toast } from "sonner";
import { RoleBadge } from "@/components/role-badge";
import { ThemeMenuItems } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useLogout, useLogoutAll, useSavedAccounts, useSwitchAccount } from "@/hooks/use-auth";
import { type Role, type SessionUser } from "@/lib/types";

interface NavItem {
  href: string;
  label: string | ((role: Role) => string);
  icon: React.ComponentType<{ className?: string }>;
  /** Highlight rule for this item, given the current path. */
  isActive: (path: string) => boolean;
}

interface NavGroup {
  label: string;
  roles?: readonly Role[];
  items: NavItem[];
}

/** The app's navigation. Add new pages here; the sidebar and breadcrumbs follow. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboardIcon, isActive: (p) => p === "/" }],
  },
  {
    label: "Service requests",
    items: [
      {
        href: "/requests",
        label: (role) => (role === "OPERATOR" ? "My requests" : "All requests"),
        icon: ClipboardListIcon,
        // The list and any request's page, but not the New request form.
        isActive: (p) => p === "/requests" || (p.startsWith("/requests/") && p !== "/requests/new"),
      },
      {
        href: "/requests/new",
        label: "New request",
        icon: PlusCircleIcon,
        isActive: (p) => p === "/requests/new",
      },
    ],
  },
  {
    label: "Administration",
    roles: ["ADMIN"],
    items: [{ href: "/admin/users", label: "Users", icon: UsersIcon, isActive: (p) => p.startsWith("/admin/users") }],
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const logout = useLogout();
  const logoutAll = useLogoutAll();
  const switchAccount = useSwitchAccount();
  const { data: accounts } = useSavedAccounts();
  const { isMobile } = useSidebar();
  const others = (accounts ?? []).filter((a) => a.id !== user.id);
  const busy = logout.isPending || logoutAll.isPending || switchAccount.isPending;

  const onLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => {
        toast.success(`Logged out of ${user.fullName}`);
        router.replace("/login");
      },
    });
  const onLogoutAll = () =>
    logoutAll.mutate(undefined, {
      onSettled: () => {
        toast.success("Logged out of all accounts");
        router.replace("/login");
      },
    });
  const onSwitch = (id: string, name: string) =>
    switchAccount.mutate(id, {
      onSuccess: () => {
        toast.success(`Switched to ${name}`);
        // The current page may not exist for the other account's role.
        router.push("/");
      },
      onError: () => toast.error(`${name}'s session has ended. Log in again to use it.`),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="data-popup-open:bg-sidebar-accent"
            aria-label={`Account menu for ${user.fullName}`}
          />
        }
      >
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg text-xs">{initials(user.fullName)}</AvatarFallback>
        </Avatar>
        <span className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{user.fullName}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
        <ChevronsUpDownIcon className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
            <span className="text-xs text-muted-foreground">Signed in as</span>
            <span className="truncate font-medium text-foreground">{user.fullName}</span>
            <span className="truncate text-xs">{user.email}</span>
            <span>
              <RoleBadge role={user.role} />
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch account</DropdownMenuLabel>
          {others.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => onSwitch(a.id, a.fullName)} disabled={busy}>
              <Avatar className="size-6 rounded-md">
                <AvatarFallback className="rounded-md text-[10px]">{initials(a.fullName)}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate">{a.fullName}</span>
                <span className="truncate text-xs text-muted-foreground">{a.email}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem render={<Link href="/login" />}>
            <UserPlusIcon /> Add another account
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} disabled={busy}>
          <LogOutIcon /> Log out of {user.fullName.split(/\s+/)[0]}
        </DropdownMenuItem>
        {others.length > 0 && (
          <DropdownMenuItem onClick={onLogoutAll} disabled={busy}>
            <LogOutIcon /> Log out of all accounts
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavSkeleton() {
  return Array.from({ length: 2 }, (_, i) => (
    <SidebarGroup key={i}>
      <SidebarMenu>
        {Array.from({ length: 2 }, (_, j) => (
          <SidebarMenuItem key={j}>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  ));
}

/** The nav groups. Reads the URL (to highlight the current page), so it renders inside Suspense. */
function NavGroups({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  // On phones the sidebar is a drawer: close it once a link is chosen.
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  return NAV_GROUPS.filter((g) => !g.roles || g.roles.includes(user.role)).map((group) => (
    <SidebarGroup key={group.label}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => {
            const label = typeof item.label === "function" ? item.label(user.role) : item.label;
            const active = item.isActive(pathname);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={label}
                  render={<Link href={item.href} aria-current={active ? "page" : undefined} onClick={closeOnMobile} />}
                >
                  <item.icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}

/**
 * Left-hand navigation for signed-in pages. Collapses to icons on desktop
 * (Ctrl/⌘+B or the button in the top bar) and becomes a drawer on phones.
 */
export function AppSidebar({ user }: { user: SessionUser | null | undefined }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" onClick={closeOnMobile} />} tooltip="CloudPulse">
              {/* Icon and name as separate children, so icon-only mode shows just the icon. */}
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                <ActivityIcon className="size-4" aria-hidden />
              </span>
              <span className="truncate font-semibold tracking-tight group-data-[collapsible=icon]:hidden">CloudPulse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {user ? (
          <Suspense fallback={<NavSkeleton />}>
            <NavGroups user={user} />
          </Suspense>
        ) : (
          <NavSkeleton />
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>{user ? <UserMenu user={user} /> : <SidebarMenuSkeleton showIcon />}</SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
