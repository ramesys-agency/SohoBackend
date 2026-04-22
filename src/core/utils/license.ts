import os from "os";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";

export async function verifyLicense(failFast: boolean = true): Promise<void> {
    const { key, serviceUrl } = config.license;

    if (!key || !serviceUrl) {
        logger.warn("License key or Service URL not configured. Skipping license verification.");
        return;
    }

    try {
        const machineId = os.hostname();
        const response = await fetch(`${serviceUrl}/api/license/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                licenseKey: key,
                machineId: machineId,
            }),
        });

        const data = (await response.json()) as any;

        if (!response.ok || data.status !== "valid") {
            logger.error("License verification failed!", {
                status: data.status,
                message: data.message,
            });
            
            // Strict Enforcement: Exit the process if license is failed
            console.error("\n\x1b[31m%s\x1b[0m", "CRITICAL: LICENSE INVALID OR REVOKED");
            console.error("\x1b[31m%s\x1b[0m", `Reason: ${data.message || "Unknown error"}`);
            console.error("\x1b[31m%s\x1b[0m", "The application will now shut down.\n");
            process.exit(1);
        } else {
            if (failFast) {
                logger.info(`License verified successfully for ${data.licensedTo}`);
                logger.info(`License type: ${data.type} (Expires: ${new Date(data.expiresAt).toLocaleDateString()})`);
            }
        }
    } catch (error) {
        if (failFast) {
            logger.error("Error connecting to license service", {
                error: error instanceof Error ? error.message : String(error),
            });
            
            logger.error("Could not verify license (Service Unreachable). Shutting down for security.");
            process.exit(1);
        } else {
            logger.warn("License heartbeat failed (Service Unreachable), retrying next cycle...", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

/**
 * Starts a periodic license check (heartbeat)
 * Default: Every 15 minutes
 */
export function startLicenseHeartbeat(intervalMs: number = 1000 * 60 * 15): void {
    logger.info(`License heartbeat started (Interval: ${intervalMs / 1000 / 60}m)`);
    
    setInterval(async () => {
        // failFast = false means network errors won't kill the app, 
        // but an EXPLICIT 'invalid' response will.
        await verifyLicense(false);
    }, intervalMs);
}
