import { z } from "zod";

/**
 * The payment methods this deployment can actually collect on.
 *
 * Cash on delivery is the only one, and that is a fact about the server, not a
 * UI preference: there is no payment gateway wired up anywhere, so an order
 * placed as anything else would go out with `cod: false` — the rider is told to
 * collect nothing and nothing else ever charges the customer. The app already
 * keeps card/wallet/bank out of its picker; this is the server refusing them
 * too, so a direct API call can't place a free order.
 *
 * Adding a method here is deliberate: it must be a method something downstream
 * knows how to charge.
 */
export const SUPPORTED_PAYMENT_METHODS = ["COD"] as const;

export type PaymentMethod = (typeof SUPPORTED_PAYMENT_METHODS)[number];

/** Cash on delivery — the method the courier collects against. */
export const COD: PaymentMethod = "COD";

/**
 * Upper bound on a single buy-now line. Matches the checkout reservation's own
 * limit so the two paths can't disagree about what an acceptable basket is.
 */
const MAX_LINE_QUANTITY = 100;

/**
 * The body of `POST /orders`.
 *
 * Everything money touches downstream comes from here, so nothing is taken on
 * trust: the quantity decides what is charged and what leaves the shelf, and
 * the payment method decides whether anyone ever collects. Prices, the delivery
 * fee and the discount are all still the server's own numbers — they are
 * deliberately absent from this schema.
 */
export const createOrderSchema = z.object({
    addressId: z.string().uuid("A valid delivery address is required"),

    paymentMethod: z
        .enum(SUPPORTED_PAYMENT_METHODS, {
            message: "Cash on delivery is the only payment method available right now",
        })
        .default(COD),

    /**
     * Buy-now skips the cart. This is the only quantity a client can state —
     * cart quantities are server-managed — so it is bounded here. Left
     * unchecked, a negative one produced a zero-value order and *increased*
     * stock, because the decrement ran with a negative amount.
     */
    buyNow: z
        .object({
            variantId: z.string().uuid("A valid product variant is required"),
            quantity: z
                .number()
                .int("Quantity must be a whole number")
                .positive("Quantity must be at least 1")
                .max(MAX_LINE_QUANTITY, `Quantity cannot exceed ${MAX_LINE_QUANTITY}`)
                .optional(),
        })
        .optional(),

    // An empty string is how a client says "no coupon"; treat it as absent
    // rather than failing the order over it.
    couponCode: z
        .string()
        .trim()
        .max(64)
        .optional()
        .transform((value) => (value ? value : undefined)),

    /** The hold taken at checkout, spent by this order. */
    checkoutId: z.string().uuid("Invalid checkout id").optional(),

    /** Explicit courier preference. Omitted, RoadRush assigns one itself. */
    aggregator: z.string().trim().min(1).max(64).optional(),

    // Used only as fallbacks when the account or the address is missing them.
    customerFullName: z.string().trim().max(120).optional(),
    customerPhone: z.string().trim().max(20).optional(),
    customerEmail: z.string().trim().max(160).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
