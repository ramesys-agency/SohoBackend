import type { OrderStatus } from "@prisma/client";

/**
 * RoadRush status mapping.
 *
 * `order_details` returns only the status *name* (e.g. "Order Place") — there is
 * no numeric code in the payload — so the name is what we match on. The codes
 * below are from RoadRush's published status table and are kept for reference
 * and logging only.
 *
 * Names are matched after stripping every non-alphanumeric character, so
 * "Shorting/ Process", "Shorting/Process" and "shorting process" all resolve to
 * the same entry. That guards against the spacing/punctuation inconsistencies
 * already visible in their table ("To Drop-Up", "Shorting/ Process").
 */

export interface RoadRushStatus {
    code: number;
    name: string;
    status: OrderStatus;
}

const normalize = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const STATUSES: RoadRushStatus[] = [
    { code: 99, name: "Pending", status: "pending" },
    { code: 101, name: "Order Place", status: "pending" },
    { code: 113, name: "On Hold", status: "pending" },
    { code: 115, name: "Agent Area Change", status: "pending" },

    { code: 102, name: "Pickup progress", status: "processing" },
    { code: 104, name: "Shorting/ Process", status: "processing" },
    { code: 105, name: "Hub Received", status: "processing" },
    { code: 106, name: "Assign rider", status: "processing" },
    { code: 108, name: "Waiting for rider accept", status: "processing" },
    { code: 109, name: "Rider Accepted", status: "processing" },

    { code: 103, name: "Picked Up", status: "shipped" },
    { code: 114, name: "To Drop-Up", status: "shipped" },
    { code: 116, name: "In Transit", status: "shipped" },
    { code: 117, name: "Delivery In Progress", status: "shipped" },

    { code: 111, name: "Completed", status: "delivered" },
    { code: 120, name: "Partial Completed", status: "delivered" },

    { code: 110, name: "Rider rejected", status: "cancelled" },
    { code: 112, name: "Cancel", status: "cancelled" },
    { code: 121, name: "Deleted", status: "cancelled" },

    { code: 107, name: "return", status: "returned" },
    { code: 118, name: "Returning", status: "returned" },
    { code: 119, name: "damaged", status: "returned" },
    { code: 122, name: "Return to RoadRush", status: "returned" },
];

const BY_NAME = new Map<string, RoadRushStatus>(STATUSES.map((s) => [normalize(s.name), s]));

// "PEN" is the code RoadRush lists for the pending (99) row; accept it as an alias
// in case the API ever echoes the code string instead of the name.
BY_NAME.set("pen", STATUSES[0] as RoadRushStatus);

/**
 * Resolve a RoadRush status name to our internal order status.
 * Returns null for anything not in the published table — callers should keep the
 * order's current status and log the unknown value rather than guess.
 */
export function mapRoadRushStatus(name: string | null | undefined): RoadRushStatus | null {
    if (!name) return null;
    return BY_NAME.get(normalize(name)) ?? null;
}

export const ROADRUSH_STATUSES = STATUSES;
