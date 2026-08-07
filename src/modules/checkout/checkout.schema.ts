import { z } from "zod";

export const reserveCheckoutSchema = z.object({
    // Omit for a cart checkout; send buyNow to hold a single variant.
    buyNow: z
        .object({
            variantId: z.string().uuid(),
            quantity: z.number().int().positive().max(100).optional(),
        })
        .optional(),
});

export type ReserveCheckoutBody = z.infer<typeof reserveCheckoutSchema>;
