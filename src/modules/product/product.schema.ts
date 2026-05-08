import { z } from "zod";

export const createProductVariantImageSchema = z.object({
    imageUrl: z.string().url("Must be a valid URL"),
    isPrimary: z.boolean().optional().default(false),
    displayOrder: z.number().int().optional().default(0),
    colorRef: z.string().optional(),
});

export const createProductVariantSchema = z.object({
    sku: z.string().min(1, "SKU is required"),
    size: z.string().optional(),
    colorName: z.string().optional(),
    colorValue: z.string().optional(),
    stockQty: z.number().int().min(0).optional().default(0),
    basePrice: z.number().positive("Base price must be positive"),
    originalPrice: z.number().positive("Original price must be positive").optional(),
    isDefault: z.boolean().optional().default(false),
    images: z
        .array(createProductVariantImageSchema)
        .min(1, "At least one image is required per variant"),
});

export const createProductSchema = z
    .object({
        name: z.string().min(1, "Product name is required"),
        description: z.string().optional(),
        categoryId: z.string().uuid("Invalid category ID").optional(),
        categoryIds: z.array(z.string().uuid("Invalid category ID")).optional(),
        collectionIds: z.array(z.string().uuid("Invalid collection ID")).optional(),
        attributes: z.record(z.string(), z.any()).optional().default({}),
        gender: z.array(z.enum(["MEN", "WOMEN", "KIDS"])).optional(),
        isPublished: z.boolean().optional().default(false),
        variants: z.array(createProductVariantSchema).min(1, "At least one variant is required"),
    })
    .superRefine((data, ctx) => {
        if (!data.categoryId && (!data.categoryIds || data.categoryIds.length === 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Category ID is required",
                path: ["categoryId"],
            });
        }
    })
    .transform((data) => {
        const finalCategoryId = data.categoryId || (data.categoryIds && data.categoryIds[0]);
        const { categoryIds: _categoryIds, ...rest } = data;
        return {
            ...rest,
            categoryId: finalCategoryId as string,
        };
    });

export const updateProductSchema = z
    .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        categoryId: z.string().uuid().optional(),
        categoryIds: z.array(z.string().uuid()).optional(),
        collectionIds: z.array(z.string().uuid()).optional(),
        attributes: z.record(z.string(), z.any()).optional(),
        gender: z.array(z.enum(["MEN", "WOMEN", "KIDS"])).optional(),
        isPublished: z.boolean().optional(),
        variants: z.array(createProductVariantSchema).optional(),
    })
    .transform((data) => {
        const finalCategoryId = data.categoryId || (data.categoryIds && data.categoryIds[0]);
        const { categoryIds: _categoryIds, ...rest } = data;
        return {
            ...rest,
            ...(finalCategoryId && { categoryId: finalCategoryId }),
        };
    });
