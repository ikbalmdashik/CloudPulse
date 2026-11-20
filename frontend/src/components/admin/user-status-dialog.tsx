"use client";

import { Loader2Icon, UserRoundPlusIcon, UserRoundXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogMedia,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSetUserStatus } from "@/hooks/use-users";
import { ApiError } from "@/lib/api";
import type { User } from "@/lib/types";

/** Confirms deactivating or reactivating a user. `user` null = closed; the action is the opposite of their state. */
export function UserStatusDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const mutation = useSetUserStatus();
  const deactivate = user?.isActive ?? true;

  const confirm = () => {
    if (!user) return;
    mutation.mutate(
      { userId: user.id, active: !deactivate },
      {
        onSuccess: (u) => toast.success(`${u.fullName} ${u.isActive ? "can log in again" : "was deactivated and signed out"}`),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't change this user"),
        onSettled: onClose,
      },
    );
  };

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogMedia tone={deactivate ? "destructive" : "success"}>
            {deactivate ? <UserRoundXIcon /> : <UserRoundPlusIcon />}
          </DialogMedia>
          <DialogTitle>{deactivate ? "Deactivate this user?" : "Reactivate this user?"}</DialogTitle>
          <DialogDescription>
            {user && (
              <>
                <span className="font-medium text-foreground">{user.fullName}</span> ({user.email}){" "}
                {deactivate
                  ? "will be signed out on every device right away and won't be able to log in. Their requests and history stay as they are."
                  : "will be able to log in again with their existing password."}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={mutation.isPending} />}>Cancel</DialogClose>
          <Button variant={deactivate ? "destructive" : "default"} onClick={confirm} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2Icon className="animate-spin" />}
            {deactivate ? "Deactivate" : "Reactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
