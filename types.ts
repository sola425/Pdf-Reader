
export interface MissedPoint {
  point: string;
  example: string;
  suggestion: string;
  relatedConcepts: string[];
}

export interface ReviewResult {
  score: number;
  summaryOfMentionedPoints: string;
  reviewOfMissedPoints: MissedPoint[];
}