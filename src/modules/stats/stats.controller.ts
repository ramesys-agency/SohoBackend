import type { NextFunction, Request, Response } from "express";
import { StatsService } from "./stats.service.js";

export class StatsController {
  private statsService = new StatsService();

  getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await this.statsService.getDashboardStats();
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  };
}
