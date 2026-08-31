import { randomUUID } from "node:crypto";
import {
    LogisticsJobStatus,
    LogisticsJobType,
    OrderStatus,
    OrderType,
    Prisma,
    type LogisticsJob,
} from "@prisma/client";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { MailService, type PrismaService } from "../../core/services/index.js";
import { NotFoundError } from "../../core/errors/http-errors.js";
import { RoadRushService } from "./roadrush.service.js";

/** The RoadRush place-order body, minus the pickup address resolved per attempt. */
export interface PlaceOrderPayload {
    aggregator?: string;
    receiver_division?: string | null;
    receiver_district?: string | null;
    receiver_thana?: string | null;
    drop_address?: string | null;
    customer_full_name: string;
    customer_mobile_number: string;
    item_value: number;
    cod: boolean;
    item_details?: string | null;
}

export type JobOutcome = "succeeded" | "failed" | "exhausted" | "skipped";

/** Identifies this process in `lockedBy` so a claim can be traced to an instance. */
const INSTANCE_ID = randomUUID();

/**
 * The durable retry queue that hands orders to RoadRush.
 *
 * The order itself is committed and acknowledged to the customer immediately;
 * the partner call happens here, where it can fail, wait, and try again without
 * anyone losing a sale. When every attempt is spent the order is flagged for
 * manual shipping and the admin team is emailed.
 */
export class LogisticsJobService {
    private prisma: PrismaService = prisma;
    private roadRush = new RoadRushService();
    private mail = new MailService();

    get retryDelaysMinutes(): number[] {
        return config.logistics.job.retryDelaysMinutes;
    }

    /** 1 immediate attempt + one per configured retry delay. */
    get maxAttempts(): number {
        return 1 + this.retryDelaysMinutes.length;
    }

    // --- Queueing ------------------------------------------------------------

    /**
     * Queue an order for sync. Called inside the order transaction so an order
     * can never exist without a sync job (and vice versa).
     */
    async enqueue(
        tx: Prisma.TransactionClient,
        orderId: string,
        payload: PlaceOrderPayload
    ): Promise<void> {
        await tx.logisticsJob.create({
            data: {
                orderId,
                type: LogisticsJobType.place_order,
                payload: payload as unknown as Prisma.InputJsonValue,
                maxAttempts: this.maxAttempts,
                nextRunAt: new Date(),
            },
        });
    }

    /**
     * Admin "try again" — reset the counter and make the job due immediately.
     * Also used after a manual fix (corrected phone number, new address).
     */
    async requeue(orderId: string): Promise<LogisticsJob> {
        const job = await this.prisma.getClient().logisticsJob.findUnique({ where: { orderId } });
        if (!job) throw new NotFoundError("No logistics job exists for this order");

        return await this.prisma.getClient().logisticsJob.update({
            where: { orderId },
            data: {
                status: LogisticsJobStatus.pending,
                attempts: 0,
                maxAttempts: this.maxAttempts,
                nextRunAt: new Date(),
                lastError: null,
                lockedAt: null,
                lockedBy: null,
            },
        });
    }

    /**
     * Drop a queued attempt that should no longer happen — an admin synced the
     * order by hand, or the order was cancelled.
     *
     * Pass the transaction when cancelling an order, so the job dies in the same
     * commit as the cancellation and a worker tick in between can't hand a
     * cancelled order to the courier.
     */
    async cancelForOrder(orderId: string, tx?: Prisma.TransactionClient): Promise<void> {
        const client = tx ?? this.prisma.getClient();

        await client.logisticsJob.updateMany({
            where: {
                orderId,
                status: { in: [LogisticsJobStatus.pending, LogisticsJobStatus.processing] },
            },
            data: { status: LogisticsJobStatus.cancelled },
        });
    }

    // --- Claiming ------------------------------------------------------------

    /**
     * Hand back jobs claimed by a process that then died. Without this a crash
     * mid-attempt would strand the order in `processing` forever.
     */
    async requeueStaleClaims(): Promise<number> {
        const cutoff = new Date(Date.now() - config.logistics.job.staleClaimMinutes * 60 * 1000);

        const { count } = await this.prisma.getClient().logisticsJob.updateMany({
            where: { status: LogisticsJobStatus.processing, lockedAt: { lt: cutoff } },
            data: { status: LogisticsJobStatus.pending, lockedBy: null, lockedAt: null },
        });

        if (count) {
            logger.warn("Requeued stale logistics job claims", { count });
        }

        return count;
    }

    /**
     * Atomically take ownership of up to `batchSize` due jobs.
     *
     * The `status: pending` guard inside the update is the actual claim — two
     * workers racing on the same rows cannot both win it, with or without Redis.
     */
    async claimDueJobs(batchSize: number): Promise<LogisticsJob[]> {
        const client = this.prisma.getClient();
        const lockedBy = `${INSTANCE_ID}:${Date.now()}`;

        const due = await client.logisticsJob.findMany({
            where: { status: LogisticsJobStatus.pending, nextRunAt: { lte: new Date() } },
            orderBy: { nextRunAt: "asc" },
            take: batchSize,
            select: { id: true },
        });

        if (!due.length) return [];

        const { count } = await client.logisticsJob.updateMany({
            where: { id: { in: due.map((j) => j.id) }, status: LogisticsJobStatus.pending },
            data: {
                status: LogisticsJobStatus.processing,
                lockedAt: new Date(),
                lockedBy,
            },
        });

        if (!count) return [];

        return await client.logisticsJob.findMany({ where: { lockedBy } });
    }

    // --- Processing ----------------------------------------------------------

    async processJob(job: LogisticsJob): Promise<JobOutcome> {
        const client = this.prisma.getClient();
        const order = await client.order.findUnique({ where: { id: job.orderId } });

        if (!order) {
            await client.logisticsJob.update({
                where: { id: job.id },
                data: { status: LogisticsJobStatus.cancelled, lastError: "Order no longer exists" },
            });
            return "skipped";
        }

        // An admin may have synced this by hand between the claim and now.
        if (order.orderCode) {
            await this.markSucceeded(job.id, order.id, order.orderCode, null);
            return "skipped";
        }

        // Cancelling an order kills its job in the same transaction, so reaching
        // here means the cancellation landed after this job was claimed. Either
        // way the parcel must not be handed over: a cancelled order sent to
        // RoadRush is a rider collecting cash for goods nobody is owed.
        if (order.status === OrderStatus.cancelled) {
            await this.prisma.getClient().logisticsJob.update({
                where: { id: job.id },
                data: {
                    status: LogisticsJobStatus.cancelled,
                    lastError: "Order was cancelled before it reached the courier",
                    lockedAt: null,
                    lockedBy: null,
                },
            });

            logger.info("Skipped courier hand-off for a cancelled order", { orderId: order.id });
            return "skipped";
        }

        const attemptNo = job.attempts + 1;
        const payload = job.payload as unknown as PlaceOrderPayload;

        try {
            // RoadRush has no idempotency key, so a request that timed out after
            // they accepted it would be re-sent here and book the courier twice.
            // On every attempt but the first, look for our order in their history
            // before posting again.
            if (job.attempts > 0) {
                const existingCode = await this.findExistingOrderCode(payload, order.createdAt);
                if (existingCode) {
                    logger.warn("Adopted an existing RoadRush order found during retry", {
                        orderId: order.id,
                        orderCode: existingCode,
                    });
                    await this.markSucceeded(job.id, order.id, existingCode, null);
                    return "succeeded";
                }
            }

            const pickupAddressId = await this.roadRush.getPickupAddressId();

            const response = await this.roadRush.placeOrder({
                marcent_pickup_address_id: pickupAddressId,
                // `aggregator` is optional — RoadRush assigns one internally when
                // it is omitted. Only forward an explicit preference.
                ...(payload.aggregator && { aggregator: payload.aggregator }),
                receiver_division: payload.receiver_division,
                receiver_district: payload.receiver_district,
                receiver_thana: payload.receiver_thana,
                drop_address: payload.drop_address,
                customer_full_name: payload.customer_full_name,
                customer_mobile_number: payload.customer_mobile_number,
                item_value: payload.item_value,
                cod: payload.cod,
                item_details: payload.item_details,
            });

            // An order_code means RoadRush took the order, whatever it calls the
            // state. It answers a real placement with status "pending" ("Awaiting
            // aggregator assignment by OPS team"), so keying off status ===
            // "success" would retry an order that already exists and double-book
            // the courier.
            const orderCode = response.order_code ?? response.order?.order_code;

            if (orderCode) {
                await this.markSucceeded(
                    job.id,
                    order.id,
                    String(orderCode),
                    String(pickupAddressId)
                );
                logger.info("Order synced with RoadRush", {
                    orderId: order.id,
                    orderCode,
                    partnerStatus: response.status,
                    attempt: attemptNo,
                });
                return "succeeded";
            }

            // No code means nothing we can track or chase — treat it as a failure
            // and try again.
            throw new Error(`RoadRush returned no order code: ${JSON.stringify(response)}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return await this.recordFailure(job, message);
        }
    }

    private async markSucceeded(
        jobId: string,
        orderId: string,
        orderCode: string,
        pickupAddressId: string | null
    ): Promise<void> {
        await this.prisma.getClient().$transaction(async (tx) => {
            const existing = await tx.order.findUnique({
                where: { id: orderId },
                select: { status: true },
            });

            // The order can be cancelled between this job being claimed and
            // RoadRush accepting it. There is no cancel call in their API, so
            // the code is still recorded — without it nobody could chase the
            // parcel — and the clash is written where staff will find it.
            if (existing?.status === OrderStatus.cancelled) {
                logger.error("RoadRush accepted an order that has since been cancelled", {
                    orderId,
                    orderCode,
                });

                await tx.orderStatusLog.create({
                    data: {
                        orderId,
                        status: OrderStatus.cancelled,
                        note: `RoadRush accepted this cancelled order as ${orderCode} — call them to stop the delivery`,
                        internal: true,
                    },
                });
            }

            await tx.order.update({
                where: { id: orderId },
                data: {
                    orderCode,
                    ...(pickupAddressId && { merchantPickupAddressId: pickupAddressId }),
                    // A retry that finally lands takes the order back off the
                    // manual-shipping list.
                    orderType: OrderType.standard,
                    manualReason: null,
                    manualFlaggedAt: null,
                },
            });

            await tx.logisticsJob.update({
                where: { id: jobId },
                data: {
                    status: LogisticsJobStatus.succeeded,
                    lastAttempt: new Date(),
                    lastError: null,
                    lockedAt: null,
                    lockedBy: null,
                },
            });
        });
    }

    private async recordFailure(job: LogisticsJob, message: string): Promise<JobOutcome> {
        const attempts = job.attempts + 1;
        const truncated = message.slice(0, 500);
        const retryIndex = attempts - 1; // delays apply after the immediate attempt
        const delayMinutes = this.retryDelaysMinutes[retryIndex];

        if (attempts >= job.maxAttempts || delayMinutes === undefined) {
            await this.prisma.getClient().logisticsJob.update({
                where: { id: job.id },
                data: {
                    status: LogisticsJobStatus.exhausted,
                    attempts,
                    lastAttempt: new Date(),
                    lastError: truncated,
                    lockedAt: null,
                    lockedBy: null,
                },
            });

            await this.flagManualShipping(job.orderId, truncated, attempts);
            return "exhausted";
        }

        const nextRunAt = new Date(Date.now() + delayMinutes * 60 * 1000);

        await this.prisma.getClient().logisticsJob.update({
            where: { id: job.id },
            data: {
                status: LogisticsJobStatus.pending,
                attempts,
                nextRunAt,
                lastAttempt: new Date(),
                lastError: truncated,
                lockedAt: null,
                lockedBy: null,
            },
        });

        logger.warn("RoadRush sync attempt failed — retry scheduled", {
            orderId: job.orderId,
            attempt: attempts,
            maxAttempts: job.maxAttempts,
            retryInMinutes: delayMinutes,
            error: truncated,
        });

        return "failed";
    }

    // --- Manual shipping fallback --------------------------------------------

    /**
     * Every automated attempt is spent. Mark the order so staff pick it up by
     * hand, and tell them about it.
     */
    async flagManualShipping(orderId: string, reason: string, attempts: number): Promise<void> {
        const order = await this.prisma.getClient().$transaction(async (tx) => {
            const updated = await tx.order.update({
                where: { id: orderId },
                data: {
                    orderType: OrderType.manual_shipping,
                    manualReason: reason,
                    manualFlaggedAt: new Date(),
                    manualHandledAt: null,
                    manualHandledBy: null,
                },
            });

            // The customer-facing status is deliberately untouched — this is a
            // change of fulfilment route, not of order progress. The note is
            // internal: the customer's timeline must never show them a courier
            // error, only that their order is being processed.
            await tx.orderStatusLog.create({
                data: {
                    orderId,
                    status: updated.status,
                    internal: true,
                    note: `Automatic logistics sync failed after ${attempts} attempt(s) — manual shipping required: ${reason}`,
                },
            });

            return updated;
        });

        logger.error("Order flagged for manual shipping", { orderId, attempts, reason });

        // Alerting must never be able to undo the flag, so it runs outside the
        // transaction and swallows its own failures.
        try {
            await this.sendManualShippingAlert(order.id);
        } catch (error) {
            logger.warn("Failed to send manual shipping alert email", {
                orderId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async sendManualShippingAlert(orderId: string): Promise<void> {
        const recipients = config.mail.adminAlertEmails;
        if (!recipients.length) {
            logger.info("No ADMIN_ALERT_EMAILS configured — skipping manual shipping email", {
                orderId,
            });
            return;
        }

        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            include: { address: true },
        });
        if (!order) return;

        const reference = order.orderCode || order.id.slice(0, 8).toUpperCase();
        const dashboardUrl = `${config.app.frontendUrl.replace(/\/$/, "")}/orders/${order.id}`;
        const address = [
            order.dropAddress,
            order.receiverThana,
            order.receiverDistrict,
            order.receiverDivision,
        ]
            .filter(Boolean)
            .join(", ");

        const lines = [
            `Order ${reference} could not be sent to the courier automatically.`,
            "",
            `Customer:  ${order.customerFullName ?? "-"}`,
            `Phone:     ${order.customerMobileNumber ?? "-"}`,
            `Address:   ${address || "-"}`,
            `Items:     ${order.itemDetails ?? "-"}`,
            `Total:     BDT ${Number(order.totalAmount).toLocaleString()}`,
            `COD:       ${order.cod ? "Yes" : "No"}`,
            "",
            `Last error: ${order.manualReason ?? "-"}`,
            "",
            `Arrange delivery manually, then mark it handled: ${dashboardUrl}`,
        ];

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #b45309; margin-top: 0;">Manual shipping required</h2>
                <p style="color: #475569; font-size: 15px;">
                    Order <strong>${reference}</strong> could not be handed to the courier automatically.
                </p>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
                    <tr><td style="padding: 4px 0;"><strong>Customer</strong></td><td>${order.customerFullName ?? "-"}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>Phone</strong></td><td>${order.customerMobileNumber ?? "-"}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>Address</strong></td><td>${address || "-"}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>Items</strong></td><td>${order.itemDetails ?? "-"}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>Total</strong></td><td>BDT ${Number(order.totalAmount).toLocaleString()}</td></tr>
                    <tr><td style="padding: 4px 0;"><strong>COD</strong></td><td>${order.cod ? "Yes" : "No"}</td></tr>
                </table>
                <p style="color: #64748b; font-size: 13px; margin-top: 16px;">
                    Last error: ${order.manualReason ?? "-"}
                </p>
                <p style="margin-top: 20px;">
                    <a href="${dashboardUrl}" style="background: #0055d4; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: bold;">Open order</a>
                </p>
            </div>
        `;

        await this.mail.sendMail(
            recipients,
            `[Soho] Manual shipping required — order ${reference}`,
            lines.join("\n"),
            html
        );
    }

    // --- Duplicate protection -------------------------------------------------

    /**
     * Look for an order we may already have placed during a failed attempt.
     * Matches on the customer's phone, the item value and a creation time at or
     * after our own order, which is as specific as the partner's history gets.
     */
    private async findExistingOrderCode(
        payload: PlaceOrderPayload,
        orderCreatedAt: Date
    ): Promise<string | null> {
        const { orders } = await this.roadRush.getOrderHistory();
        if (!Array.isArray(orders)) return null;

        const earliest = orderCreatedAt.getTime() - 2 * 60 * 1000;

        const match = orders.find((candidate: any) => {
            const phone = String(candidate?.customer_mobile_number ?? "");
            if (phone !== payload.customer_mobile_number) return false;

            const value = Number(candidate?.item_value ?? NaN);
            if (!Number.isNaN(value) && Math.abs(value - payload.item_value) > 0.01) return false;

            const created = new Date(candidate?.created ?? candidate?.Created_at ?? 0).getTime();
            if (Number.isNaN(created) || created === 0) return false;

            return created >= earliest;
        });

        return match?.order_code ? String(match.order_code) : null;
    }
}

export const logisticsJobService = new LogisticsJobService();
