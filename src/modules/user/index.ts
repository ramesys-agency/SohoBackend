import { Router } from "express";
import { UserRoutes } from "./user.routes.js";

export function registerUserModule(): Router {
    return UserRoutes.routes;
}
