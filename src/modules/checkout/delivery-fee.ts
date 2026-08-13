import { config } from "../../config/index.js";

/**
 * Which delivery rate an address falls under. Dhaka district is the cheaper
 * inside-Dhaka rate; everything else in the country pays the outside-Dhaka rate.
 */
export type DeliveryRegion = "INSIDE_DHAKA" | "OUTSIDE_DHAKA";

/** Human label for the region, shown next to the fee in the app and on invoices. */
export const DELIVERY_REGION_LABELS: Record<DeliveryRegion, string> = {
    INSIDE_DHAKA: "Inside Dhaka",
    OUTSIDE_DHAKA: "Outside Dhaka",
};

/**
 * The district name that counts as inside Dhaka. Deliberately the *district*
 * and not the division: Gazipur and Narayanganj sit in Dhaka division but are
 * out-of-city runs the courier charges the higher rate for.
 */
const INSIDE_DHAKA_DISTRICT = "dhaka";

/** The parts of an address this decision is allowed to look at. */
export interface DeliveryRegionSource {
    district?: string | null;
    city?: string | null;
}

const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();

/**
 * Resolves the region for a drop address. `district` is what the address form
 * collects from the courier's own district list, so it is the primary signal;
 * `city` is only a fallback for older rows saved before districts were captured.
 * Anything we can't place is treated as outside Dhaka — under-charging our own
 * delivery is a loss we eat, over-charging is one the customer eats.
 */
export function resolveDeliveryRegion(address: DeliveryRegionSource): DeliveryRegion {
    const district = normalize(address.district);
    const city = normalize(address.city);

    if (district) {
        return district === INSIDE_DHAKA_DISTRICT ? "INSIDE_DHAKA" : "OUTSIDE_DHAKA";
    }

    return city === INSIDE_DHAKA_DISTRICT ? "INSIDE_DHAKA" : "OUTSIDE_DHAKA";
}

/** The charge for a region, in BDT. */
export function getDeliveryFee(region: DeliveryRegion): number {
    return config.checkout.deliveryFees[region];
}

/** Resolves the region and its fee together — what order creation needs. */
export function resolveDeliveryFee(address: DeliveryRegionSource): {
    region: DeliveryRegion;
    label: string;
    fee: number;
} {
    const region = resolveDeliveryRegion(address);
    return {
        region,
        label: DELIVERY_REGION_LABELS[region],
        fee: getDeliveryFee(region),
    };
}
