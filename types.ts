
export interface MissedPoint {
  point: string;
  example: string;
  suggestion: string;
  relatedConcepts: string[];
  pageNumber: number;
}

export interface ReviewResult {
  score: number;
  scoreRationale: string;
  summaryOfMentionedPoints: string;
  reviewOfMissedPoints: MissedPoint[];
}