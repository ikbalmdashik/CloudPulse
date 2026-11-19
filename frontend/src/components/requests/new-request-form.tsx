"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateRequest } from "@/hooks/use-requests";
import { ApiError } from "@/lib/api";
import { CATEGORY_HINT, CATEGORY_LABEL, ENVIRONMENT_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import { CATEGORIES, ENVIRONMENTS, PRIORITIES } from "@/lib/types";
import { type NewRequestForm as FormValues, newRequestFormSchema } from "@/lib/validation";

const SERVER_FIELDS = ["title", "description", "category", "priority"] as const;

/**
 * The New request page. Next 16 keeps visited pages alive in the background,
 * so without this the form would still hold the last request when opened
 * again. Changing the key after a submit (or Cancel) remounts the form empty,
 * with a fresh idempotency key. (react-hook-form's `reset()` can't be used:
 * with the React Compiler it disconnects the inputs.)
 */
export function NewRequestForm() {
  const [instance, setInstance] = useState(0);
  return <RequestForm key={instance} onDone={() => setInstance((n) => n + 1)} />;
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const create = useCreateRequest();
  // One key per form, made on the first submit and reused on retries, so
  // resubmitting after a network error can't create a duplicate request.
  const idempotencyKey = useRef<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(newRequestFormSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "VM_PROVISIONING",
      priority: "MEDIUM",
      environment: "staging",
      target: "",
    },
  });
  const category = useWatch({ control, name: "category" });

  const onSubmit = handleSubmit(({ environment, target, description, ...rest }) =>
    create.mutate(
      {
        input: { ...rest, description: description || undefined, payload: { environment, target } },
        idempotencyKey: (idempotencyKey.current ??= crypto.randomUUID()),
      },
      {
        onSuccess: (request) => {
          toast.success(`${request.code} submitted`, { description: request.title });
          router.push(`/requests/${request.id}`);
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 400) {
            const byField = err.fieldErrors();
            for (const f of SERVER_FIELDS) if (byField[f]) setError(f, { message: byField[f] });
            if (byField["payload.target"]) setError("target", { message: byField["payload.target"] });
          }
        },
      },
    ),
  );

  const formError =
    create.error && !(create.error instanceof ApiError && create.error.status === 400)
      ? create.error.message
      : null;

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle className="text-xl">New service request</CardTitle>
        <CardDescription>
          Tell the operations team what you need. You can follow its progress live once it&apos;s submitted.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent>
          <FieldGroup>
            {formError && (
              <Alert variant="destructive" role="alert">
                <CircleAlertIcon />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Field data-invalid={!!errors.title}>
              <FieldLabel htmlFor="title">Title</FieldLabel>
              <Input
                id="title"
                placeholder="e.g. Provision a 4 vCPU VM for the billing service"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
              <FieldError errors={[errors.title]} />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={!!errors.category}>
                <FieldLabel htmlFor="category">Category</FieldLabel>
                <Controller
                  control={control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                      <SelectTrigger id="category" className="w-full" aria-invalid={!!errors.category}>
                        <SelectValue>{(v: (typeof CATEGORIES)[number]) => CATEGORY_LABEL[v]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CATEGORY_LABEL[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>{CATEGORY_HINT[category]}</FieldDescription>
                <FieldError errors={[errors.category]} />
              </Field>

              <Field data-invalid={!!errors.priority}>
                <FieldLabel htmlFor="priority">Priority</FieldLabel>
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                      <SelectTrigger id="priority" className="w-full" aria-invalid={!!errors.priority}>
                        <SelectValue>{(v: (typeof PRIORITIES)[number]) => PRIORITY_LABEL[v]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PRIORITY_LABEL[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.priority]} />
              </Field>

              <Field data-invalid={!!errors.environment}>
                <FieldLabel htmlFor="environment">Environment</FieldLabel>
                <Controller
                  control={control}
                  name="environment"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                      <SelectTrigger id="environment" className="w-full" aria-invalid={!!errors.environment}>
                        <SelectValue>{(v: (typeof ENVIRONMENTS)[number]) => ENVIRONMENT_LABEL[v]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ENVIRONMENTS.map((e) => (
                          <SelectItem key={e} value={e}>
                            {ENVIRONMENT_LABEL[e]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError errors={[errors.environment]} />
              </Field>

              <Field data-invalid={!!errors.target}>
                <FieldLabel htmlFor="target">Target</FieldLabel>
                <Input
                  id="target"
                  placeholder="Host, service or account"
                  aria-invalid={!!errors.target}
                  {...register("target")}
                />
                <FieldError errors={[errors.target]} />
              </Field>
            </div>

            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor="description">Details (optional)</FieldLabel>
              <Textarea
                id="description"
                rows={4}
                placeholder="Anything the team should know: sizes, deadlines, links…"
                aria-invalid={!!errors.description}
                {...register("description")}
              />
              <FieldError errors={[errors.description]} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 justify-end gap-2">
          <Link href="/requests" className={buttonVariants({ variant: "outline" })} onClick={onDone}>
            Cancel
          </Link>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" />}
            Submit request
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
