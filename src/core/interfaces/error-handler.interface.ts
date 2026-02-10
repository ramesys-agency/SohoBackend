import type { Request, Response, NextFunction } from "express";

export interface IErrorHandler {
    handle(err: Error, req: Request, res: Response, next: NextFunction): void;
    middleware(): (err: Error, req: Request, res: Response, next: NextFunction) => void;
}
