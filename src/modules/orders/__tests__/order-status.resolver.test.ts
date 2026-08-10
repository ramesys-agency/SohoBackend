import { describe, expect, it } from "vitest";
import { OrderStatus, StatusSource } from "@prisma/client";
import { canAdvance, resolveOrderStatus, type StatusInputs } from "../order-status.resolver.js";

/**
 * Arbitration between the admin's opinion and RoadRush's. These are the rules
 * that stop the two writers overwriting each other — the whole point of the
 * split, so they are tested on their own, without a database.
 */

/** An order handed to the courier, with neither side having said anything yet. */
const base: StatusInputs = {
    current: OrderStatus.pending,
    currentSource: StatusSource.system,
    admin: null,
    logistics: null,
    handedOff: true,
    pinned: false,
};

const resolve = (over: Partial<StatusInputs>) => resolveOrderStatus({ ...base, ...over });

describe("canAdvance", () => {
    it("only moves forward", () => {
        expect(canAdvance(OrderStatus.pending, OrderStatus.shipped)).toBe(true);
        expect(canAdvance(OrderStatus.shipped, OrderStatus.pending)).toBe(false);
        expect(canAdvance(OrderStatus.shipped, OrderStatus.shipped)).toBe(false);
    });

    it("lets the courier skip rungs the admin ladder forbids", () => {
        expect(canAdvance(OrderStatus.pending, OrderStatus.delivered)).toBe(true);
    });

    it("leaves a return as the only way out of delivered", () => {
        expect(canAdvance(OrderStatus.delivered, OrderStatus.returned)).toBe(true);
        expect(canAdvance(OrderStatus.delivered, OrderStatus.cancelled)).toBe(false);
        expect(canAdvance(OrderStatus.delivered, OrderStatus.shipped)).toBe(false);
    });

    it("lets nothing out of an exit", () => {
        for (const to of Object.values(OrderStatus)) {
            expect(canAdvance(OrderStatus.cancelled, to)).toBe(false);
            expect(canAdvance(OrderStatus.returned, to)).toBe(false);
        }
    });
});

describe("when the courier has no say", () => {
    it("hands an unsynced order entirely to the admin", () => {
        const out = resolve({
            handedOff: false,
            admin: OrderStatus.processing,
            logistics: OrderStatus.delivered,
        });

        expect(out.status).toBe(OrderStatus.processing);
        expect(out.source).toBe(StatusSource.admin);
        expect(out.conflict).toBe(false);
    });

    it("keeps the current status when nobody has an opinion", () => {
        const out = resolve({ current: OrderStatus.processing, currentSource: StatusSource.admin });

        expect(out.status).toBe(OrderStatus.processing);
        expect(out.source).toBe(StatusSource.admin);
    });
});

describe("the courier's word on where the parcel ended up", () => {
    it("beats a status an admin clicked", () => {
        const out = resolve({
            current: OrderStatus.shipped,
            admin: OrderStatus.shipped,
            logistics: OrderStatus.delivered,
        });

        expect(out.status).toBe(OrderStatus.delivered);
        expect(out.source).toBe(StatusSource.roadrush);
        expect(out.conflict).toBe(false);
    });

    it("beats a pin — a click cannot move a parcel", () => {
        const out = resolve({
            current: OrderStatus.shipped,
            admin: OrderStatus.shipped,
            logistics: OrderStatus.returned,
            pinned: true,
        });

        expect(out.status).toBe(OrderStatus.returned);
    });

    it("does not swallow the admin recording a return on top of it", () => {
        // A return is the step after a delivery, not a contradiction of it.
        const out = resolve({
            current: OrderStatus.delivered,
            currentSource: StatusSource.roadrush,
            admin: OrderStatus.returned,
            logistics: OrderStatus.delivered,
        });

        expect(out.status).toBe(OrderStatus.returned);
        expect(out.source).toBe(StatusSource.admin);
    });

    it("still wins where the two are genuinely in tension", () => {
        // Admin wants it cancelled; RoadRush already handed it to the customer.
        const out = resolve({
            current: OrderStatus.delivered,
            currentSource: StatusSource.roadrush,
            admin: OrderStatus.cancelled,
            logistics: OrderStatus.delivered,
        });

        expect(out.status).toBe(OrderStatus.delivered);
        expect(out.conflict).toBe(true);
    });

    it("flags it when we had already called the order delivered", () => {
        const out = resolve({
            current: OrderStatus.delivered,
            admin: OrderStatus.delivered,
            logistics: OrderStatus.returned,
        });

        expect(out.status).toBe(OrderStatus.returned);
        expect(out.conflict).toBe(true);
        expect(out.conflictReason).toMatch(/check the payment and the stock/i);
    });
});

describe("an admin cancellation", () => {
    it("is honoured locally and says the courier still has the parcel", () => {
        const out = resolve({
            current: OrderStatus.processing,
            admin: OrderStatus.cancelled,
            logistics: OrderStatus.shipped,
        });

        expect(out.status).toBe(OrderStatus.cancelled);
        expect(out.source).toBe(StatusSource.admin);
        expect(out.conflict).toBe(true);
        expect(out.conflictReason).toMatch(/call them/i);
    });

    it("raises no conflict once the courier agrees", () => {
        const out = resolve({
            current: OrderStatus.cancelled,
            admin: OrderStatus.cancelled,
            logistics: OrderStatus.cancelled,
        });

        expect(out.status).toBe(OrderStatus.cancelled);
        expect(out.conflict).toBe(false);
    });

    it("survives the next poll — this is the bug that started all of it", () => {
        // Admin cancelled; RoadRush is still reporting the rider it assigned.
        const out = resolve({
            current: OrderStatus.cancelled,
            currentSource: StatusSource.admin,
            admin: OrderStatus.cancelled,
            logistics: OrderStatus.processing,
        });

        expect(out.status).toBe(OrderStatus.cancelled);
    });
});

describe("a courier cancellation", () => {
    it("waits for a human rather than restocking on a rider's rejection", () => {
        const out = resolve({
            current: OrderStatus.processing,
            currentSource: StatusSource.admin,
            admin: OrderStatus.processing,
            logistics: OrderStatus.cancelled,
        });

        expect(out.status).toBe(OrderStatus.processing);
        expect(out.conflict).toBe(true);
        expect(out.conflictReason).toMatch(/restock/i);
    });
});

describe("a pinned status", () => {
    it("stops the courier moving the order", () => {
        const out = resolve({
            current: OrderStatus.processing,
            currentSource: StatusSource.admin,
            admin: OrderStatus.processing,
            logistics: OrderStatus.shipped,
            pinned: true,
        });

        expect(out.status).toBe(OrderStatus.processing);
        expect(out.conflict).toBe(true);
        expect(out.conflictReason).toMatch(/pinned/i);
    });

    it("does not stop the admin — a pin is not a freeze", () => {
        const out = resolve({
            current: OrderStatus.processing,
            currentSource: StatusSource.admin,
            admin: OrderStatus.shipped,
            logistics: OrderStatus.processing,
            pinned: true,
        });

        expect(out.status).toBe(OrderStatus.shipped);
        expect(out.source).toBe(StatusSource.admin);
    });
});

describe("ordinary progression", () => {
    it("takes whichever side is further along", () => {
        expect(
            resolve({ admin: OrderStatus.processing, logistics: OrderStatus.shipped }).status
        ).toBe(OrderStatus.shipped);

        expect(
            resolve({
                current: OrderStatus.processing,
                admin: OrderStatus.shipped,
                logistics: OrderStatus.processing,
            }).status
        ).toBe(OrderStatus.shipped);
    });

    it("ignores a courier read that arrives out of order", () => {
        const out = resolve({
            current: OrderStatus.shipped,
            currentSource: StatusSource.roadrush,
            logistics: OrderStatus.pending,
        });

        expect(out.status).toBe(OrderStatus.shipped);
        expect(out.conflict).toBe(false);
    });

    it("does not treat a stale admin click as a disagreement", () => {
        // The admin marked it processing an hour ago; the courier has moved on.
        // That is the happy path, not something a human needs to look at.
        const out = resolve({
            current: OrderStatus.processing,
            admin: OrderStatus.processing,
            logistics: OrderStatus.shipped,
        });

        expect(out.status).toBe(OrderStatus.shipped);
        expect(out.conflict).toBe(false);
    });
});

describe("an admin override", () => {
    it("is the one thing allowed to walk a status backwards", () => {
        const out = resolve({
            current: OrderStatus.delivered,
            admin: OrderStatus.shipped,
            logistics: OrderStatus.delivered,
            force: true,
        });

        expect(out.status).toBe(OrderStatus.shipped);
        expect(out.source).toBe(StatusSource.admin);
    });

    it("carries the courier's name when it is RoadRush's status being accepted", () => {
        const out = resolve({
            current: OrderStatus.processing,
            admin: OrderStatus.cancelled,
            logistics: OrderStatus.cancelled,
            force: true,
            forceSource: StatusSource.roadrush,
        });

        expect(out.status).toBe(OrderStatus.cancelled);
        expect(out.source).toBe(StatusSource.roadrush);
        expect(out.conflict).toBe(false);
    });
});
