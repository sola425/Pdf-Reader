import { Document, ProcessedPageData, Annotation, StudyProgress, Flashcard } from '../types';

const DB_NAME = 'RecallReaderDB';
const DB_VERSION = 5; // Incremented version for schema change
const DOCUMENT_STORE = 'documents';
const PROCESSED_DATA_STORE = 'processedData';
const ANNOTATION_STORE = 'annotations';
const STUDY_PROGRESS_STORE = 'studyProgress';
const FLASHCARD_STORE = 'flashcards';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error('Failed to open IndexedDB.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROCESSED_DATA_STORE)) {
        db.createObjectStore(PROCESSED_DATA_STORE); // Key will be docId
      }
      if (!db.objectStoreNames.contains(ANNOTATION_STORE)) {
        const annotationStore = db.createObjectStore(ANNOTATION_STORE, { keyPath: 'id' });
        annotationStore.createIndex('docId_pageNum', ['docId', 'pageNum'], { unique: false });
      }
       if (!db.objectStoreNames.contains(STUDY_PROGRESS_STORE)) {
        db.createObjectStore(STUDY_PROGRESS_STORE, { keyPath: 'docId' });
      }
      if (!db.objectStoreNames.contains(FLASHCARD_STORE)) {
        const flashcardStore = db.createObjectStore(FLASHCARD_STORE, { keyPath: 'id' });
        flashcardStore.createIndex('docId', 'docId', { unique: false });
      }
    };
  });
};

// --- Document Management ---

export const addDocument = async (file: File): Promise<Document> => {
  const now = new Date();
  const newDoc: Document = {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    createdAt: now,
    lastOpenedAt: now,
    processingStatus: 'processing',
    processedPages: 0,
  };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE], 'readwrite');
    const store = transaction.objectStore(DOCUMENT_STORE);
    const request = store.put(newDoc);
    transaction.oncomplete = () => resolve(newDoc);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const updateDocument = async (doc: Document): Promise<Document> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([DOCUMENT_STORE], 'readwrite');
        const store = transaction.objectStore(DOCUMENT_STORE);
        const request = store.put(doc);
        transaction.oncomplete = () => resolve(doc);
        transaction.onerror = () => reject(transaction.error);
    });
};

export const getDocument = async (id: string): Promise<Document | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
      const transaction = db.transaction([DOCUMENT_STORE], 'readonly');
      const store = transaction.objectStore(DOCUMENT_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
  });
};

export const getAllDocuments = async (): Promise<Document[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENT_STORE], 'readonly');
    const store = transaction.objectStore(DOCUMENT_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.lastOpenedAt.getTime() - a.lastOpenedAt.getTime()));
    request.onerror = () => reject(request.error);
  });
};

export const deleteDocument = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([DOCUMENT_STORE, PROCESSED_DATA_STORE, ANNOTATION_STORE, STUDY_PROGRESS_STORE, FLASHCARD_STORE], 'readwrite');
        transaction.objectStore(DOCUMENT_STORE).delete(id);
        transaction.objectStore(PROCESSED_DATA_STORE).delete(id);
        transaction.objectStore(STUDY_PROGRESS_STORE).delete(id);
        
        const annotationStore = transaction.objectStore(ANNOTATION_STORE);
        const annoIndex = annotationStore.index('docId_pageNum');
        const annoRange = IDBKeyRange.bound([id, 0], [id, Infinity]);
        const annoCursorRequest = annoIndex.openCursor(annoRange);
        annoCursorRequest.onsuccess = () => {
            const cursor = annoCursorRequest.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        const flashcardStore = transaction.objectStore(FLASHCARD_STORE);
        const flashcardIndex = flashcardStore.index('docId');
        const flashcardRange = IDBKeyRange.only(id);
        const flashcardCursorReq = flashcardIndex.openCursor(flashcardRange);
        flashcardCursorReq.onsuccess = () => {
            const cursor = flashcardCursorReq.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event);
    });
};

// --- Processed Data Management ---

export const saveProcessedData = async (docId: string, data: ProcessedPageData[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROCESSED_DATA_STORE], 'readwrite');
    const store = transaction.objectStore(PROCESSED_DATA_STORE);
    store.put(data, docId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const appendProcessedPages = async (docId: string, pageDataBatch: ProcessedPageData[]): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([PROCESSED_DATA_STORE], 'readwrite');
        const store = transaction.objectStore(PROCESSED_DATA_STORE);
        const getRequest = store.get(docId);

        getRequest.onsuccess = () => {
            const existingData: ProcessedPageData[] = getRequest.result || [];
            const updatedData = [...existingData, ...pageDataBatch];
            // Sort to ensure pages are in order, just in case
            updatedData.sort((a, b) => a.pageNum - b.pageNum);
            store.put(updatedData, docId);
        };
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};


export const loadProcessedData = async (docId: string): Promise<ProcessedPageData[] | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PROCESSED_DATA_STORE], 'readonly');
    const store = transaction.objectStore(PROCESSED_DATA_STORE);
    const request = store.get(docId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};


// --- Annotation Management ---

export const saveAnnotation = async (annotation: Annotation): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([ANNOTATION_STORE], 'readwrite');
        transaction.objectStore(ANNOTATION_STORE).put(annotation);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

export const getAnnotationsForDocument = async (docId: string): Promise<Annotation[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([ANNOTATION_STORE], 'readonly');
        const store = transaction.objectStore(ANNOTATION_STORE);
        const index = store.index('docId_pageNum');
        const request = index.getAll(IDBKeyRange.bound([docId, 0], [docId, Infinity]));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const deleteAnnotation = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([ANNOTATION_STORE], 'readwrite');
        transaction.objectStore(ANNOTATION_STORE).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

// --- Study Progress Management ---
export const getStudyProgress = async (docId: string): Promise<StudyProgress | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STUDY_PROGRESS_STORE], 'readonly');
        const store = transaction.objectStore(STUDY_PROGRESS_STORE);
        const request = store.get(docId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
};

export const saveStudyProgress = async (progress: StudyProgress): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STUDY_PROGRESS_STORE], 'readwrite');
        transaction.objectStore(STUDY_PROGRESS_STORE).put(progress);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

// --- Flashcard Management ---
export const saveFlashcards = async (flashcards: Flashcard[]): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([FLASHCARD_STORE], 'readwrite');
        const store = transaction.objectStore(FLASHCARD_STORE);
        flashcards.forEach(card => store.put(card));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

export const getFlashcardsForDocument = async (docId: string): Promise<Flashcard[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([FLASHCARD_STORE], 'readonly');
        const store = transaction.objectStore(FLASHCARD_STORE);
        const index = store.index('docId');
        const request = index.getAll(docId);
        request.onsuccess = () => resolve(request.result.sort((a,b) => a.term.localeCompare(b.term)));
        request.onerror = () => reject(request.error);
    });
};

export const deleteFlashcard = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([FLASHCARD_STORE], 'readwrite');
        transaction.objectStore(FLASHCARD_STORE).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};