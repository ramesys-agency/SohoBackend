import { OrderStatus, StatusSource } from "@prisma/client";

/**
 * Arbitration between the two things that have an opinion about an order:
 * the admin clicking in the dashboard, and RoadRush reporting what its riders
 * did. Both used to write `Order.status` directly, so whoever wrote last won —
 * which is how a cancelled order came back to life on the next poll.
 *
 * Now each writes only its own column and this function decides the effective
 * status. It is deliberately pure: no database, no clock, no side effects, so
 * the rules can be read and tested on their own.
 */

/**
 * How far along an order is. Drives the forward-only guard — a stale or
 * out-of-order courier read can never drag an order backwards.
 *
 * `cancelled` and `returned` share the top rank: both are exits, reachable from
 * anywhere before delivery, with nothing reachable from them.
 */
const RANK: Record<OrderStatus, number> = {
    [OrderStatus.pending]: 0,
    [OrderStatus.processing]: 1,
    [OrderStatus.shipped]: 2,
    [OrderStatus.delivered]: 3,
    [OrderStatus.returned]: 4,
    [OrderStatus.cancelled]: 4,
};

/** Nothing moves out of these. */
const EXITS: readonly OrderStatus[] = [OrderStatus.cancelled, OrderStatus.returned];

/**
 * Courier states we act on the moment we see them. Both are unambiguous
 * physical outcomes — the parcel is in the customer's hands or back in ours.
 *
 * RoadRush's cancelled-ish states are NOT here on purpose. "Rider rejected"
 * collapses onto `cancelled` in our enum but often just means the next rider
 * takes it, and acting on it would restock the units. Those raise a conflict
 * for a human instead.
 */
const COURIER_FINAL: readonly OrderStatus[] = [OrderStatus.delivered, OrderStatus.returned];

/**
 * Whether `to` is a legal forward move from `from`.
 *
 * Looser than the admin ladder in ADMIN_STATUS_TRANSITIONS — the courier is
 * allowed to skip rungs (an order can go straight from pending to shipped if
 * that is what RoadRush reports), it just cannot go back down them.
 */
export function canAdvance(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) return false;
    if (EXITS.includes(from)) return false;
    // The goods reached the customer, so the only thing left is them coming back.
    if (from === OrderStatus.delivered) return to === OrderStatus.returned;
    return (RANK[to] as number) > (RANK[from] as number);
}

export interface StatusInputs {
    /** The effective status as stored today. */
    current: OrderStatus;
    /** Who decided `current`. Returned unchanged when nothing moves. */
    currentSource: StatusSource;
    /** The last status a human asked for, or null if nobody has. */
    admin: OrderStatus | null;
    /** RoadRush's status collapsed onto our enum, or null before the first sync. */
    logistics: OrderStatus | null;
    /**
     * The order is genuinely with the courier. False for orders never synced and
     * for `manual_shipping` ones staff are delivering themselves — RoadRush has
     * no standing to overrule the admin on those.
     */
    handedOff: boolean;
    /** An admin pinned the status. The courier may flag it but not move it. */
    pinned: boolean;
    /**
     * This resolve is an explicit admin override. The only path allowed to walk
     * a status backwards — it is how a mistake gets corrected.
     */
    force?: boolean;
    /** Who the forced value came from. "Accept RoadRush" forces on their behalf. */
    forceSource?: StatusSource;
}

export interface StatusOutcome {
    status: OrderStatus;
    source: StatusSource;
    /** A disagreement a human has to settle. */
    conflict: boolean;
    /** Plain-English reason, shown on the order and in the queue. Null if none. */
    conflictReason: string | null;
}

export function resolveOrderStatus(input: StatusInputs): StatusOutcome {
    const { current, currentSource, admin, logistics, handedOff, pinned } = input;
    const force = input.force === true;

    // An override is the way out of every rule below, including the forward-only
    // guard. Without it there would be no way back from a status set by mistake.
    if (force && admin) {
        return withConflict(
            { status: admin, source: input.forceSource ?? StatusSource.admin },
            admin,
            logistics,
            false
        );
    }

    // Nothing to arbitrate: the courier has no opinion on this order, either
    // because it was never handed over or because staff are shipping it by hand.
    if (!handedOff || logistics === null) {
        const status = admin && canAdvance(current, admin) ? admin : current;
        return {
            status,
            source: status === admin ? StatusSource.admin : currentSource,
            conflict: false,
            conflictReason: null,
        };
    }

    // The courier reported a physical outcome. Where the parcel actually ended up
    // outranks anything clicked in the dashboard — but only where the two are
    // actually in tension. An admin recording a return on top of the courier's
    // delivery is the next step, not a contradiction, so it still goes through.
    if (COURIER_FINAL.includes(logistics)) {
        const candidate = ahead(admin, logistics);
        const status = canAdvance(current, candidate) ? candidate : current;
        return withConflict(
            {
                status,
                source:
                    status === current
                        ? currentSource
                        : candidate === admin
                          ? StatusSource.admin
                          : StatusSource.roadrush,
            },
            admin,
            logistics,
            pinned
        );
    }

    // The admin cancelled. RoadRush has no cancel endpoint, so we can only honour
    // it on our side — and say loudly that their copy is still live.
    if (admin === OrderStatus.cancelled) {
        const status = canAdvance(current, OrderStatus.cancelled) ? OrderStatus.cancelled : current;
        return withConflict(
            {
                status,
                source: status === OrderStatus.cancelled ? StatusSource.admin : currentSource,
            },
            admin,
            logistics,
            pinned
        );
    }

    // RoadRush says the delivery is off. Not applied automatically — it may just
    // be a rider bouncing the job, and applying it would put stock back on the
    // shelf. A human decides.
    if (logistics === OrderStatus.cancelled && current !== OrderStatus.cancelled) {
        return {
            status: current,
            source: currentSource,
            conflict: true,
            conflictReason:
                "RoadRush has cancelled this delivery. Accept it to cancel the order and restock the units, or keep your status if a rider is still coming.",
        };
    }

    // An admin took ownership of this order's status. The courier reports but no
    // longer drives — the admin still can, a pin is not a freeze.
    if (pinned) {
        const status = admin && canAdvance(current, admin) ? admin : current;
        return withConflict(
            { status, source: status === admin ? StatusSource.admin : currentSource },
            admin,
            logistics,
            true
        );
    }

    // The ordinary case: whoever is further along wins, and only forwards.
    const candidate = ahead(admin, logistics);
    const status = canAdvance(current, candidate) ? candidate : current;

    return {
        status,
        source:
            status === current
                ? currentSource
                : candidate === admin
                  ? StatusSource.admin
                  : StatusSource.roadrush,
        conflict: false,
        conflictReason: null,
    };
}

/**
 * Whichever of the two opinions is further along. Ties go to the courier — they
 * are the ones who can see the parcel.
 */
function ahead(admin: OrderStatus | null, logistics: OrderStatus): OrderStatus {
    if (admin === null) return logistics;
    return (RANK[admin] as number) > (RANK[logistics] as number) ? admin : logistics;
}

/**
 * Attach the conflict verdict to a decided status.
 *
 * Only substantive disagreements count. An admin's stale click being overtaken
 * by the courier is normal progression, not a conflict — flagging those would
 * bury the real ones.
 */
function withConflict(
    decided: { status: OrderStatus; source: StatusSource },
    admin: OrderStatus | null,
    logistics: OrderStatus | null,
    pinned: boolean
): StatusOutcome {
    const reason = conflictReason(decided.status, admin, logistics, pinned);
    return { ...decided, conflict: reason !== null, conflictReason: reason };
}

function conflictReason(
    effective: OrderStatus,
    admin: OrderStatus | null,
    logistics: OrderStatus | null,
    pinned: boolean
): string | null {
    if (logistics === null) return null;

    // We cancelled, they did not. Their copy is still live and no API can stop
    // it — someone has to phone RoadRush.
    if (admin === OrderStatus.cancelled && logistics !== OrderStatus.cancelled) {
        return `This order was cancelled here, but RoadRush still has it as "${logistics}". Call them to stop the delivery.`;
    }

    // They ended it, we thought it landed. Money and stock both need a look.
    if (EXITS.includes(logistics) && admin === OrderStatus.delivered) {
        return `This order was marked delivered here, but RoadRush reports "${logistics}". Check the payment and the stock.`;
    }

    if (pinned && logistics !== effective) {
        return `The status is pinned to "${effective}" — RoadRush reports "${logistics}".`;
    }

    return null;
}
