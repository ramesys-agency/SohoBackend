export class HttpError extends Error {
    constructor(
        public statusCode: number,
        message: string
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export class BadRequestError extends HttpError {
    constructor(message = "Bad Request") {
        super(400, message);
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
    constructor(message = "Not Found") {
        super(404, message);
    }
}

export class ValidationError extends HttpError {
    constructor(message = "Validation Error") {
        super(422, message);
    }
}
