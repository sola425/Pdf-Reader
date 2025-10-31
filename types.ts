
export interface MissedPoint {
  point: string;
  example: string;
  suggestion: string;
}

export interface ReviewResult {
  score: number;
  summaryOfMentionedPoints: string;
  reviewOfMissedPoints: MissedPoint[];
}