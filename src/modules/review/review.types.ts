export interface AddReviewDto {
    rating: number;
    comment?: string;
    images?: string[];
    videos?: string[];
}

export interface UpdateReviewDto {
    rating?: number;
    comment?: string;
    images?: string[];
    videos?: string[];
}
