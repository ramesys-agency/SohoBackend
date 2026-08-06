import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";

/**
 * A single entry from `order_details` -> `status_details`.
 * Note the inconsistent key casing — it mirrors the API exactly.
 */
export interface RoadRushStatusDetail {
    status_name: string;
    Description?: string;
    Created_at: string;
    Created_by?: number;
}

/**
 * The `order` object returned by `order_details`.
 * Key casing mirrors the API verbatim (`Cash_Collect`, `Fee`, `COD_charge`, ...).
 */
export interface RoadRushOrderDetails {
    id: number;
    order_code: string;
    status: string;
    customer_full_name?: string;
    customer_mobile_number?: string;
    customer_email?: string;
    drop_address?: string;
    item_value?: number;
    cod?: boolean;
    item_details?: string;
    receiver_division?: string;
    receiver_district?: string;
    receiver_thana?: string;
    Cash_Collect?: number;
    distance_km?: number;
    Fee?: number;
    COD_charge?: number;
    Vat?: number;
    Tax?: number;
    created?: string;
    updated?: string;
    delivery_priority?: string;
    Dop_Note?: string;
    otp?: string;
    rcv_pay?: boolean;
    RequestDeliveryDate?: string;
    status_details?: RoadRushStatusDetail[];
    comments?: unknown[];
}

export interface RoadRushSenderAddress {
    id: number;
    name: string;
    address: string;
    division?: string;
    district?: string;
    thana?: string;
    sender_full_name?: string;
    sender_phone_number?: string;
    [key: string]: unknown;
}

export interface RoadRushOrderDetailsResponse {
    status: string;
    order?: RoadRushOrderDetails;
    /** Older/alternate response shape — kept as a fallback. */
    order_details?: RoadRushOrderDetails;
}

/**
 * RoadRush Service for external API communication
 * Handles authentication, location data, and order placement.
 */
export class RoadRushService {
    private readonly baseUrl: string;
    private readonly username?: string | undefined;
    private readonly password?: string | undefined;
    private readonly pickupAddressId?: number | undefined;

    constructor() {
        this.baseUrl = config.logistics.baseUrl;
        this.username = config.logistics.username;
        this.password = config.logistics.password;
        this.pickupAddressId = config.logistics.pickupAddressId;
    }

    /**
     * Get or fetch access token
     */
    private async getToken(): Promise<string> {
        const cacheKey = "logistics:roadrush:token";

        // Try to get token from cache if enabled
        if (config.redis.enabled) {
            try {
                const cachedToken = await redis.get<string>(cacheKey);
                if (cachedToken) {
                    return cachedToken;
                }
            } catch (error) {
                logger.warn("Failed to get RoadRush token from redis", { 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
        }

        if (!this.username || !this.password) {
            throw new Error("RoadRush credentials not configured in environment variables");
        }

        logger.info("Fetching new RoadRush access token");

        const response = await fetch(`${this.baseUrl}/login/`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                username: this.username,
                password: this.password,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            logger.error("RoadRush login failed", { error, status: response.status });
            throw new Error(`RoadRush login failed: ${response.statusText}`);
        }

        const data = (await response.json()) as { access: string };
        const token = data.access;

        // Cache token if enabled
        if (config.redis.enabled) {
            try {
                await redis.set(cacheKey, token, { ttl: 3600 });
            } catch (error) {
                logger.warn("Failed to cache RoadRush token", { 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
        }

        return token;
    }

    /**
     * Generic request helper
     */
    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const token = await this.getToken();

        const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            const error = await response.text();
            logger.error(`RoadRush request failed: ${url}`, { error, status: response.status });
            throw new Error(`RoadRush API error: ${response.statusText} (${response.status})`);
        }

        return (await response.json()) as T;
    }

    // --- Locations ---

    async getDivisions() {
        return this.request<{ status: string; data: any[] }>("/divisions/");
    }

    async getDistricts(divisionId: string) {
        return this.request<{ status: string; data: any[] }>(
            `/districts/?division_id=${divisionId}`
        );
    }

    async getThanas(districtId: string) {
        return this.request<{ status: string; data: any[] }>(`/thanas/?district_id=${districtId}`);
    }

    async getAreas(thanaId: string) {
        return this.request<{ status: string; data: any[] }>(`/areas/?thana_id=${thanaId}`);
    }

    // --- Addresses ---

    async getSenderAddresses() {
        return this.request<{
            status: string;
            count?: number;
            sender_addresses: RoadRushSenderAddress[];
        }>("/sender-address/");
    }

    /**
     * Resolve the merchant pickup address id to send as `marcent_pickup_address_id`.
     *
     * Prefers the configured id; when unset, falls back to the first sender
     * address registered on the RoadRush account (cached, since it effectively
     * never changes). Set ROADRUSH_PICKUP_ADDRESS_ID once the account has more
     * than one pickup address, otherwise the fallback choice is arbitrary.
     */
    async getPickupAddressId(): Promise<number> {
        if (this.pickupAddressId) return this.pickupAddressId;

        const cacheKey = "logistics:roadrush:pickup-address-id";

        if (config.redis.enabled) {
            try {
                const cached = await redis.get<number>(cacheKey);
                if (cached) return cached;
            } catch (error) {
                logger.warn("Failed to get RoadRush pickup address id from redis", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const { sender_addresses: addresses } = await this.getSenderAddresses();

        if (!addresses?.length) {
            throw new Error(
                "No RoadRush pickup address is registered for this account — add one, or set ROADRUSH_PICKUP_ADDRESS_ID"
            );
        }

        if (addresses.length > 1) {
            logger.warn(
                "RoadRush account has multiple pickup addresses; using the first. Set ROADRUSH_PICKUP_ADDRESS_ID to pin one.",
                { ids: addresses.map((a) => a.id) }
            );
        }

        const id = addresses[0]!.id;

        if (config.redis.enabled) {
            try {
                await redis.set(cacheKey, id, { ttl: 86400 });
            } catch (error) {
                logger.warn("Failed to cache RoadRush pickup address id", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return id;
    }

    async addPickupAddress(data: any) {
        return this.request<{ status: string; data: any }>("/add-pickup-address/", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }

    // --- Orders ---

    async getAggregators() {
        return this.request<{ status: string; aggregators: any[] }>("/aggregators/");
    }

    async placeOrder(orderData: any) {
        return this.request<{ status: string; order?: any; order_code?: string }>("/place-order/", {
            method: "POST",
            body: JSON.stringify(orderData),
        });
    }

    async getOrderHistory() {
        return this.request<{ status: string; orders: any[] }>("/order-history/");
    }

    async getOrderDetails(orderCode: string) {
        return this.request<RoadRushOrderDetailsResponse>("/order_details/", {
            method: "POST",
            body: JSON.stringify({ order_code: orderCode }),
        });
    }
}
