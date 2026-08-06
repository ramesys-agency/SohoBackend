import type { ReturnStatus } from "@prisma/client";

/** One line of a return — a quantity of a single order item coming back. */
export interface CreateReturnItemDto {
    orderItemId: string;
    /** Defaults to 1. Must not exceed the units still eligible on that item. */
    quantity?: number;
    reason: string;
}

export interface AdminCreateReturnDto {
    items: CreateReturnItemDto[];
    /** Internal note shared across every line in this submission. */
    note?: string;
    /**
     * When true (the default) the order flips to `returned` once every purchased
     * unit is covered by a live return. Pass false to keep the order as-is —
     * useful when only part of a shipment is coming back.
     */
    markOrderReturned?: boolean;
}

export interface AdminUpdateReturnDto {
    status: ReturnStatus;
    note?: string;
    /**
     * Only read when moving to `refunded`. Defaults to quantity x priceAtBuy.
     */
    refundAmount?: number | string;
}

export interface ReturnFilterParams {
    status?: string;
    search?: string;
}
