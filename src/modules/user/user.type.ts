import z from "zod";

export const updateProfileSchema = z.object({
    fullName: z.string().optional(),
    phone: z.string().optional(),
    gender: z.string().optional(),
    age: z.number().int().positive().optional(),
});
