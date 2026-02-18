import { z } from "zod";

export const SignupSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters long"),
        fullName: z.string().min(2, "Full name must be at least 2 characters long"),
        phone: z.string().optional(),
    }),
});

export const SignupSchemaStrict = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters long"),
        fullName: z.string().min(2, "Full name must be at least 2 characters long"),
        phone: z.string().min(10, "Phone number must be at least 10 digits"),
    }),
});

export const LoginSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(1, "Password is required"),
    }),
});

export const ForgotPasswordSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
    }),
});

export const ResetPasswordSchema = z.object({
    body: z.object({
        token: z.string().min(1, "Token is required"),
        password: z.string().min(8, "Password must be at least 8 characters long"),
    }),
});

export type SignupInput = z.infer<typeof SignupSchemaStrict>["body"];
export type LoginInput = z.infer<typeof LoginSchema>["body"];
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>["body"];
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>["body"];
