"use client";

import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type AssignableRole, useChangeRole } from "@/hooks/use-users";
import { ApiError } from "@/lib/api";
import type { User } from "@/lib/types";

export interface RoleChange {
  user: User;
  role: AssignableRole;
}

const COPY: Record<AssignableRole, { title: string; body: string; action: string; done: string }> = {
  SUPERVISOR: {
    title: "Promote to supervisor?",
    body: "will be able to monitor every service request in real time.",
    action: "Promote",
    done: "is now a supervisor",
  },
  OPERATOR: {
    title: "Demote to operator?",
    body: "will lose supervisor access and only see their own requests.",
    action: "Demote",
    done: "is now an operator",
  },
};

/** Confirms a promotion or demotion. `change` null = closed. */
export function RoleChangeDialog({ change, onClose }: { change: RoleChange | null; onClose: () => void }) {
  const mutation = useChangeRole();
  const copy = change ? COPY[change.role] : null;

  const confirm = () => {
    if (!change) return;
    mutation.mutate(
      { userId: change.user.id, role: change.role },
      {
        onSuccess: (updated) => toast.success(`${updated.fullName} ${COPY[change.role].done}`),
        // 409: someone else changed this user meanwhile; the list refreshes to show it.
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't change this user's role"),
        onSettled: onClose,
      },
    );
  };

  return (
    <Dialog open={change !== null} onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>
            {change && (
              <>
                <span className="font-medium text-foreground">{change.user.fullName}</span> ({change.user.email}){" "}
                {copy?.body}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={mutation.isPending} />}>Cancel</DialogClose>
          <Button
            variant={change?.role === "OPERATOR" ? "destructive" : "default"}
            onClick={confirm}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2Icon className="animate-spin" />}
            {copy?.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
