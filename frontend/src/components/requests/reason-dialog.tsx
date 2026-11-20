"use client";

import { Loader2Icon, MessageSquareTextIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/** Confirmation dialog that asks for a reason (required or optional). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  required,
  pending,
  destructive,
  icon,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  required?: boolean;
  pending?: boolean;
  destructive?: boolean;
  /** Shown above the title; defaults to a warning sign for destructive actions. */
  icon?: ReactNode;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const missing = required && reason.trim() === "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        if (!o) {
          setReason("");
          setTouched(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!missing) onConfirm(reason.trim());
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogMedia tone={destructive ? "destructive" : "default"}>
              {icon ?? (destructive ? <TriangleAlertIcon /> : <MessageSquareTextIcon />)}
            </DialogMedia>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={touched && missing}>
            <FieldLabel htmlFor="reason">
              {label}
              {!required && <span className="font-normal text-muted-foreground"> (optional)</span>}
            </FieldLabel>
            <Textarea
              id="reason"
              rows={3}
              maxLength={500}
              value={reason}
              aria-invalid={touched && missing}
              onChange={(e) => setReason(e.target.value)}
            />
            {touched && missing && <FieldError>Please give a reason.</FieldError>}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Back</DialogClose>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
