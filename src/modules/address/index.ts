import { Router } from "express";
import { AddressRoutes } from "./address.routes.js";

export function registerAddressModule(): Router {
    return AddressRoutes.routes;
}
