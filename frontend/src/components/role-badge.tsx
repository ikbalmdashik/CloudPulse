import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/types";

const LABEL: Record<Role, string> = { OPERATOR: "Operator", SUPERVISOR: "Supervisor", ADMIN: "Admin" };
const VARIANT: Record<Role, "outline" | "secondary" | "default"> = {
  OPERATOR: "outline",
  SUPERVISOR: "secondary",
  ADMIN: "default",
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={VARIANT[role]}>{LABEL[role]}</Badge>;
}

export function roleLabel(role: Role) {
  return LABEL[role];
}
