import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";

/**
 * RoadRush Service for external API communication
 * Handles authentication, location data, and order placement.
 */
export class RoadRushService {
    private readonly baseUrl: string;
    private readonly username?: string | undefined;
    private readonly password?: string | undefined;

    constructor() {
        this.baseUrl = config.logistics.baseUrl;
        this.username = config.logistics.username;
        this.password = config.logistics.password;
    }

    /**
     * Get or fetch access token
     */
    private async getToken(): Promise<string> {
        const cacheKey = "logistics:roadrush:token";

        // Try to get token from cache
        try {
            const cachedToken = await redis.get<string>(cacheKey);
            if (cachedToken) {
                return cachedToken;
            }
        } catch (error) {
            logger.warn("Failed to get RoadRush token from redis", { error });
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

        // Cache token for 1 hour
        try {
            await redis.set(cacheKey, token, { ttl: 3600 });
        } catch (error) {
            logger.warn("Failed to cache RoadRush token", { error });
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
        return this.request<{ status: string; sender_addresses: any[] }>("/sender-address/");
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
        return this.request<{ status: string; order: any }>("/place-order/", {
            method: "POST",
            body: JSON.stringify(orderData),
        });
    }

    async getOrderHistory() {
        return this.request<{ status: string; orders: any[] }>("/order-history/");
    }

    async getOrderDetails(orderCode: string) {
        return this.request<{ status: string; order: any }>("/order_details/", {
            method: "POST",
            body: JSON.stringify({ order_code: orderCode }),
        });
    }
}
