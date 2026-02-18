import { z } from "zod";

export const SignupSchema = z.object({
    body: z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters long"),
        fullName: z.string().min(2, "Full name must be at least 2 characters long"),
        phone: z.string().optional(), // Made phone optional based on User model having phone as String?
        // Note: User request says "Signup will be done using email, password, name and phone number".
        // Use regex for phone if it's strictly required, but model has it optional?
        // Let's make it required as per USER REQUEST, even if DB allows null?
        // "Signup will be done using email, password, name and phone number." -> implies all are required.
    }),
});

// Refine phone to be required if user insists, but let's check strictness.
// User said: "Signup will be done using email, password, name and phone number."
// So I will make it required in the schema.
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

export type SignupInput = z.infer<typeof SignupSchemaStrict>["body"];
export type LoginInput = z.infer<typeof LoginSchema>["body"];
