// Defines shared types used across the application.

export interface ProcessedPageData {
  pageNum: number;
  text: string;
  image: string; // This will be a base64 encoded string, NOT a Data URL
}

export interface Document {
  id: string; // A unique identifier (e.g., UUID)
  file: File;
  name: string;
  createdAt: Date;
  lastOpenedAt: Date;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processedPages: number;
  totalPages?: number;
  lastScrollTop?: number;
  lastScale?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Annotation {
  id: string; // Unique ID for the annotation
  docId: string; // Foreign key to the Document
  pageNum: number;
  type: 'highlight';
  content: string; // The selected text content
  rects: Rect[]; // Position data for multi-line highlights
  createdAt: Date;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: string; // The correct option text
  topic: string;
}

export interface StudyTopicProgress {
  topic: string;
  correct: number;
  total: number;
  lastReviewed: Date;
}

export interface StudyProgress {
  docId: string;
  progress: StudyTopicProgress[];
}


export interface MissedPoint {
  topic: string;
  quoteFromDocument: string;
  pageNum: number;
}

export interface RecallAnalysisResult {
  score: {
    recall: number; // 0-100
    accuracy: number; // 0-100
  };
  feedback: string;
  missedPoints: MissedPoint[];
}

export interface Flashcard {
  id: string;
  docId: string;
  term: string;
  definition: string;
  pageNum: number;
}