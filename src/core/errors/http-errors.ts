export class HttpError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        /**
         * Optional machine-readable payload sent back as `data`. Used where the
         * client has to act on the specifics of the failure — e.g. which cart
         * lines ran out of stock, not just that something did.
         */
        public details?: unknown
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export class BadRequestError extends HttpError {
    constructor(message = "Bad Request", details?: unknown) {
        super(400, message, details);
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message = "Unauthorized") {
        super(401, message);
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = "Forbidden") {
        super(403, message);
    }
}

export class NotFoundError extends HttpError {
    constructor(message: string = "Resource not found") {
        super(404, message);
    }
}

export class ConflictError extends HttpError {
    constructor(message: string = "Resource already exists", details?: unknown) {
        super(409, message, details);
    }
}

export class ValidationError extends HttpError {
    constructor(message = "Validation Error") {
        super(422, message);
    }
}
