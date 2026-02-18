import { createAuthRouter } from "./auth.routes.js";

export function registerAuthModule() {
    return createAuthRouter();
}

export * from "./auth.service.js";
export * from "./auth.controller.js";
export * from "./auth.schema.js";
export * from "./auth.utils.js";
