import * as z from "zod";
import { CATEGORIES, ENVIRONMENTS, PRIORITIES } from "./types";

/*
 * Client-side form rules. They mirror the backend's zod schemas
 * (backend/src/users/dto/create-user.schema.ts), so users see problems before
 * submitting. The backend still validates everything; it is the authority.
 */

export const loginFormSchema = z.object({
  email: z.string().trim().min(1, { error: "Enter your email" }),
  password: z.string().min(1, { error: "Enter your password" }),
  /** Stay signed in on this device across browser restarts (backend: REMEMBER_ME_DAYS). */
  rememberMe: z.boolean(),
});
export type LoginForm = z.infer<typeof loginFormSchema>;

export const registerFormSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, { error: "Name must be at least 2 characters" })
      .max(100, { error: "Name must be at most 100 characters" }),
    email: z
      .string()
      .trim()
      .min(1, { error: "Enter your email" })
      .pipe(z.email({ error: "Enter a valid email address" })),
    password: z
      .string()
      .min(8, { error: "Use at least 8 characters" })
      .max(128, { error: "Use at most 128 characters" })
      .regex(/[A-Za-z]/, { error: "Include at least one letter" })
      .regex(/\d/, { error: "Include at least one digit" }),
    confirmPassword: z.string().min(1, { error: "Confirm your password" }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    error: "Passwords don't match",
  });
export type RegisterForm = z.infer<typeof registerFormSchema>;

/** Mirrors backend/src/requests/dto/request.schemas.ts (createRequestSchema). */
export const newRequestFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, { error: "Use at least 3 characters" })
    .max(120, { error: "Use at most 120 characters" }),
  description: z.string().trim().max(2000, { error: "Use at most 2000 characters" }),
  category: z.enum(CATEGORIES, { error: "Choose a category" }),
  priority: z.enum(PRIORITIES, { error: "Choose a priority" }),
  environment: z.enum(ENVIRONMENTS, { error: "Choose an environment" }),
  target: z
    .string()
    .trim()
    .min(1, { error: "Name the host, service or account" })
    .max(200, { error: "Use at most 200 characters" }),
});
export type NewRequestForm = z.infer<typeof newRequestFormSchema>;
