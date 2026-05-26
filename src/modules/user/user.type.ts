import z from "zod";

export const updateProfileSchema = z.object({
    fullName: z.string().optional(),
    phone: z.string().optional(),
    gender: z.string().optional(),
    age: z.number().int().positive().optional(),
    region: z.string().optional(),
});

export const createAdminSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    fullName: z.string(),
    phone: z.string().optional(),
    region: z.string().optional(),
});

