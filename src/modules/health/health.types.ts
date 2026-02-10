export interface HealthStatus {
    status: "ok" | "degraded" | "error";
    timestamp: string;
    uptime: number;
    database?: {
        connected: boolean;
    };
    cache?: {
        connected: boolean;
    };
}
