import { describe, expect, it } from "vitest";
import { config } from "../../../config/index.js";
import { envSchema } from "../../../config/env.schema.js";
import { resolveDeliveryFee, resolveDeliveryRegion } from "../delivery-fee.js";

/**
 * The delivery charge is decided from the drop address alone, so the region rule
 * is pinned here: this is the one input that changes what the courier collects
 * and the client never gets a say in it.
 */

const INSIDE = config.checkout.deliveryFees.INSIDE_DHAKA;
const OUTSIDE = config.checkout.deliveryFees.OUTSIDE_DHAKA;

describe("resolveDeliveryRegion", () => {
    it.each(["Dhaka", "dhaka", " DHAKA "])("places district %s inside Dhaka", (district) => {
        expect(resolveDeliveryRegion({ district })).toBe("INSIDE_DHAKA");
    });

    it.each(["Gazipur", "Narayanganj", "Chattogram", "Sylhet"])(
        "charges %s the outside-Dhaka rate",
        (district) => {
            // Gazipur and Narayanganj are in Dhaka *division* — matching on the
            // division would hand them the city rate for an out-of-city run.
            expect(resolveDeliveryRegion({ district })).toBe("OUTSIDE_DHAKA");
        }
    );

    it("falls back to city for rows saved before districts were captured", () => {
        expect(resolveDeliveryRegion({ district: null, city: "Dhaka" })).toBe("INSIDE_DHAKA");
        expect(resolveDeliveryRegion({ district: "", city: "Khulna" })).toBe("OUTSIDE_DHAKA");
    });

    it("treats an unplaceable address as outside Dhaka", () => {
        // Under-charging is a loss we absorb; over-charging is one the customer
        // absorbs, so the unknown case takes the rate that can't surprise them.
        expect(resolveDeliveryRegion({})).toBe("OUTSIDE_DHAKA");
    });

    it("ignores a district that merely contains Dhaka", () => {
        expect(resolveDeliveryRegion({ district: "Dhaka North" })).toBe("OUTSIDE_DHAKA");
    });
});

describe("resolveDeliveryFee", () => {
    it("quotes the inside-Dhaka rate with its label", () => {
        expect(resolveDeliveryFee({ district: "Dhaka" })).toEqual({
            region: "INSIDE_DHAKA",
            label: "Inside Dhaka",
            fee: INSIDE,
        });
    });

    it("quotes the outside-Dhaka rate with its label", () => {
        expect(resolveDeliveryFee({ district: "Rajshahi" })).toEqual({
            region: "OUTSIDE_DHAKA",
            label: "Outside Dhaka",
            fee: OUTSIDE,
        });
    });

    it("ships with ৳80 inside Dhaka and ৳150 outside when unconfigured", () => {
        // The agreed rates, so a deployment that sets neither variable still
        // charges what the storefront and the policy pages say it charges.
        const defaults = envSchema.partial().parse({});

        expect(defaults.DELIVERY_FEE_INSIDE_DHAKA).toBe(80);
        expect(defaults.DELIVERY_FEE_OUTSIDE_DHAKA).toBe(150);
    });
});
