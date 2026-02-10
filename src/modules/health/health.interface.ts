import type { HealthStatus } from "./health.types.js";

export interface IHealthService {
    getHealthStatus(): Promise<HealthStatus>;
}
