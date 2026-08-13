import { describe, expect, it } from "vitest";
import { createOrderSchema } from "../orders.schema.js";

/**
 * The order payload is the one place a client gets to state something that
 * decides money: how many units, and by what method they will be paid for.
 * Both used to be taken verbatim, so both are pinned here — without a database,
 * because the rules are the schema's own.
 */

const addressId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";

const parse = (body: unknown) => createOrderSchema.safeParse(body);

describe("createOrderSchema", () => {
    it("accepts the app's cash-on-delivery payload", () => {
        const result = parse({ addressId, paymentMethod: "COD" });

        expect(result.success).toBe(true);
        expect(result.data?.paymentMethod).toBe("COD");
    });

    it("defaults an omitted payment method to cash on delivery", () => {
        expect(parse({ addressId }).data?.paymentMethod).toBe("COD");
    });

    it.each(["CARD", "WALLET", "BANK", "", "cod"])(
        "refuses %s — nothing downstream can collect it",
        (paymentMethod) => {
            // Left unchecked these placed a real order with `cod: false`: the
            // rider is told to collect nothing and no gateway exists to charge.
            expect(parse({ addressId, paymentMethod }).success).toBe(false);
        }
    );

    it("refuses a negative buy-now quantity", () => {
        // This one made a zero-value order and *increased* stock, because the
        // decrement ran with a negative amount.
        expect(parse({ addressId, buyNow: { variantId, quantity: -5 } }).success).toBe(false);
    });

    it.each([0, 1.5, 101])("refuses a buy-now quantity of %s", (quantity) => {
        expect(parse({ addressId, buyNow: { variantId, quantity } }).success).toBe(false);
    });

    it("accepts a buy-now line with a sane quantity, and one without", () => {
        expect(parse({ addressId, buyNow: { variantId, quantity: 3 } }).success).toBe(true);
        expect(parse({ addressId, buyNow: { variantId } }).success).toBe(true);
    });

    it("requires a real address id", () => {
        expect(parse({ addressId: "not-a-uuid" }).success).toBe(false);
        expect(parse({}).success).toBe(false);
    });

    it("treats an empty coupon code as no coupon", () => {
        expect(parse({ addressId, couponCode: "" }).data?.couponCode).toBeUndefined();
        expect(parse({ addressId, couponCode: " SAVE10 " }).data?.couponCode).toBe("SAVE10");
    });

    it("ignores prices a client tries to state itself", () => {
        const result = parse({
            addressId,
            totalAmount: 1,
            shippingFee: 0,
            discountAmount: 9999,
        });

        expect(result.success).toBe(true);
        expect(result.data).not.toHaveProperty("totalAmount");
        expect(result.data).not.toHaveProperty("shippingFee");
        expect(result.data).not.toHaveProperty("discountAmount");
    });
});
