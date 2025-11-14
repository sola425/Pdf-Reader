
// --- Start of code for PdfProcessingWorker.ts ---

import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

/**
 * The ProcessedPageData interface is defined here to avoid module import issues in the worker context.
 * This makes the worker self-contained and resolves startup loading errors.
 */
interface ProcessedPageData {
  pageNum: number;
  text: string;
  image: string; // This will be a base64 encoded string, NOT a Data URL
}


// Set up the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

// Define the messages we can receive
type WorkerMessage = {
  type: 'process';
  file: File;
};

// Define the messages we can send
type AppMessage = 
  | { type: 'progress'; page: number; total: number }
  | { type: 'complete'; data: ProcessedPageData[] }
  | { type: 'error'; message: string };

// Post a message back to the main app
const post = (message: AppMessage) => {
  self.postMessage(message);
};

// This is the main listener for the worker
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === 'process') {
    const file = event.data.file;
    const processedData: ProcessedPageData[] = [];

    try {
      // Use file.arrayBuffer() which is available in workers, instead of FileReader
      const fileBuffer = await file.arrayBuffer();

      try {
        const typedarray = new Uint8Array(fileBuffer);
        const doc = await pdfjsLib.getDocument({ data: typedarray }).promise;
        const numPages = doc.numPages;

        for (let i = 1; i <= numPages; i++) {
          const page = await doc.getPage(i);
          
          // 1. Extract Text
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(' ').trim();
          
          // 2. Extract Image
          // We render a medium-quality, fast image for the AI
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = new OffscreenCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');
          
          if (!context) {
            post({ type: 'error', message: `Could not get canvas context for page ${i}` });
            return;
          }

          await page.render({ canvasContext: context, viewport }).promise;
          
          // Convert canvas to a Base64 JPEG blob
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
          
          // Convert blob to base64 without using FileReader
          const blobBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(blobBuffer);
          let binary = '';
          for (let j = 0; j < uint8Array.byteLength; j++) {
            binary += String.fromCharCode(uint8Array[j]);
          }
          const base64Data = btoa(binary);

          processedData.push({
            pageNum: i,
            text: pageText,
            image: base64Data
          });

          // Send a progress update
          post({ type: 'progress', page: i, total: numPages });
        }

        // All done, send the complete data payload
        post({ type: 'complete', data: processedData });

      } catch (err: any) {
        post({ type: 'error', message: `PDF Processing Error: ${err.message}` });
      }
    } catch (err: any) {
      post({ type: 'error', message: `Worker Error: ${err.message}` });
    }
  }
};

// This line is needed to make TypeScript treat this as a module
export {};
// --- End of code for PdfProcessingWorker.ts ---