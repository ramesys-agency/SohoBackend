import type { Expo, ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from "expo-server-sdk";
import { prisma } from "../../../config/prisma.js";

/** A syntactically valid Expo push token, so the real static validator accepts it. */
export function pushToken(seed: string): string {
    return `ExponentPushToken[${seed.padEnd(22, "x").slice(0, 22)}]`;
}

export interface SendCall {
    messages: ExpoPushMessage[];
}

/**
 * Stands in for the Expo HTTP client.
 *
 * Only the four methods the queue actually calls are implemented; chunking is
 * kept real so a test that queues 250 devices still exercises the 100-per-request
 * limit rather than a convenient fiction.
 */
export class FakeExpo {
    readonly sendCalls: SendCall[] = [];
    readonly receiptCalls: string[][] = [];

    /** Queue of responses; each send consumes one. Falls back to all-ok. */
    sendQueue: (ExpoPushTicket[] | Error)[] = [];
    /** ticketId -> receipt. Missing ids model "Expo has not decided yet". */
    receipts: Record<string, ExpoPushReceipt> = {};
    receiptError: Error | null = null;

    private ticketCounter = 0;

    async sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
        this.sendCalls.push({ messages });

        const next = this.sendQueue.shift();
        if (next instanceof Error) throw next;
        if (next) return next;

        return messages.map(() => ({
            status: "ok" as const,
            id: `ticket-${++this.ticketCounter}`,
        }));
    }

    async getPushNotificationReceiptsAsync(
        ids: string[]
    ): Promise<Record<string, ExpoPushReceipt>> {
        this.receiptCalls.push(ids);
        if (this.receiptError) throw this.receiptError;

        const out: Record<string, ExpoPushReceipt> = {};
        for (const id of ids) {
            const receipt = this.receipts[id];
            if (receipt) out[id] = receipt;
        }
        return out;
    }

    chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
        return chunk(messages, 100);
    }

    chunkPushNotificationReceiptIds(ids: string[]): string[][] {
        return chunk(ids, 300);
    }

    /** The service only depends on the four methods above. */
    asExpo(): Expo {
        return this as unknown as Expo;
    }

    /** Every message the fake has been asked to send, flattened. */
    get sentMessages(): ExpoPushMessage[] {
        return this.sendCalls.flatMap((c) => c.messages);
    }
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

// --- Fixtures ---------------------------------------------------------------

let userSeq = 0;

export async function createUser(overrides: { region?: string; role?: "customer" | "admin" } = {}) {
    return await prisma.getClient().user.create({
        data: {
            email: `push-test-${++userSeq}-${Date.now()}@example.com`,
            fullName: `Push Test ${userSeq}`,
            ...(overrides.region ? { region: overrides.region } : {}),
            ...(overrides.role ? { role: overrides.role } : {}),
        },
    });
}

export async function addDevice(userId: string, platform: "ios" | "android", seed?: string) {
    const token = pushToken(seed ?? `${platform}-${userId.slice(0, 8)}-${Math.random().toString(36).slice(2)}`);
    await prisma.getClient().pushToken.create({ data: { userId, token, platform } });
    return token;
}

/** Wipe everything the push tests touch, in FK-safe order. */
export async function resetDatabase(): Promise<void> {
    const client = prisma.getClient();
    await client.pushJob.deleteMany({});
    await client.pushToken.deleteMany({});
    await client.notification.deleteMany({});
    await client.user.deleteMany({});
}
