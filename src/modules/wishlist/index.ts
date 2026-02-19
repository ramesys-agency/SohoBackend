export * from "./wishlist.routes.js";
export * from "./wishlist.controller.js";
export * from "./wishlist.service.js";

import { registerWishlistRoutes } from "./wishlist.routes.js";

export const registerWishlistModule = registerWishlistRoutes;
