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

export const GoogleAuthSchema = z.object({
    body: z.object({
        idToken: z.string().min(1, "ID token is required"),
    }),
});

export const AppleAuthSchema = z.object({
    body: z.object({
        identityToken: z.string().min(1, "Identity token is required"),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
    }),
});

export const SendOtpSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
    }),
});

export const VerifyOtpSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
        otp: z.string().length(6, "OTP must be exactly 6 digits"),
    }),
});

export type SignupInput = z.infer<typeof SignupSchema>["body"];
export type LoginInput = z.infer<typeof LoginSchema>["body"];
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>["body"];
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>["body"];
export type GoogleAuthInput = z.infer<typeof GoogleAuthSchema>["body"];
export type AppleAuthInput = z.infer<typeof AppleAuthSchema>["body"];
export type SendOtpInput = z.infer<typeof SendOtpSchema>["body"];
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>["body"];

