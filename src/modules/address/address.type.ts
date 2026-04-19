import z from "zod";

export const createAddressSchema = z.object({
    type: z.string().min(1, "Type is required"),
    street: z.string().min(1, "Street is required"),
    city: z.string().optional(),
    state: z.string().optional(),
    division: z.string().optional(),
    district: z.string().optional(),
    thana: z.string().optional(),
    area: z.string().optional(),
    postalCode: z.string().min(1, "Postal code is required"),
    country: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    placeId: z.string().optional(),
    formattedAddress: z.string().optional(),
    isDefault: z.boolean().optional().default(false),
});

export const updateAddressSchema = z.object({
    type: z.string().min(1).optional(),
    street: z.string().min(1).optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    division: z.string().optional(),
    district: z.string().optional(),
    thana: z.string().optional(),
    area: z.string().optional(),
    postalCode: z.string().min(1).optional(),
    country: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    placeId: z.string().optional(),
    formattedAddress: z.string().optional(),
    isDefault: z.boolean().optional(),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
