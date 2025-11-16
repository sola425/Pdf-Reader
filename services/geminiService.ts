
import { GoogleGenAI, Modality, LiveServerMessage, Chat, Part, FunctionDeclaration, Type } from "@google/genai";
import { encode } from '../utils/audio';
import { QuizQuestion, RecallAnalysisResult, Flashcard, StudyProgress } from "../types";

let ai: GoogleGenAI | null = null;

function getAiInstance(): GoogleGenAI {
    if (!ai) {
        // FIX: Made the API key check more robust to prevent a `ReferenceError` if the `process` object is not defined. This check safely handles undeclared, null, and other falsy cases.
        if (typeof process === 'undefined' || !process || !process.env || !process.env.API_KEY) {
            throw new Error("Gemini API key not found. Please set the API_KEY environment variable.");
        }
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
}

export async function getSummary(contextParts: Part[]): Promise<string> {
    const aiInstance = getAiInstance();
    const prompt = `Based *only* on the following document content, which includes page text and images, provide a concise, bulleted summary of the key points. Use markdown for formatting.`;

    const response = await aiInstance.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{text: prompt}, ...contextParts] }
    });
    return response.text;
}

export async function summarizeText(text: string): Promise<string> {
    const aiInstance = getAiInstance();
    const response = await aiInstance.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Provide a concise, one-paragraph summary of the following text:\n\n---\n${text}\n---`,
    });
    return response.text;
}

export async function explainText(text: string): Promise<string> {
    const aiInstance = getAiInstance();
    const response = await aiInstance.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Explain the following concept in simple, easy-to-understand terms:\n\n---\n${text}\n---`,
    });
    return response.text;
}

const quizQuestionSchema = {
    type: Type.OBJECT,
    properties: {
        question: { type: Type.STRING, description: 'The question text.' },
        topic: { type: Type.STRING, description: 'A one or two-word topic for the question (e.g., "Photosynthesis", "Newton\'s Laws").' },
        options: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'An array of 4 possible answers.' },
        answer: { type: Type.STRING, description: 'The correct answer string, which must exactly match one of the items in the options array.' },
    },
    required: ['question', 'topic', 'options', 'answer'],
};

export async function generateQuiz(contextParts: Part[], numQuestions: number, studyProgress?: StudyProgress | null): Promise<QuizQuestion[]> {
    const aiInstance = getAiInstance();
    
    let progressSummary = '';
    if (studyProgress && studyProgress.progress.length > 0) {
        progressSummary = 'The user has previously been quizzed on these topics with the following performance (correct/total):\n' +
            studyProgress.progress.map(p => `- ${p.topic}: ${p.correct}/${p.total}`).join('\n') +
            '\nBased on this, generate some more challenging questions for topics the user has mastered and more foundational questions for topics they are struggling with.';
    }

    const prompt = `Based on the following document content (text and images), generate ${numQuestions} distinct multiple-choice questions to test understanding of the key concepts. Each question should have 4 options, with only one correct answer. Ensure the questions cover different topics from the text.
    ${progressSummary}`;
    
    const response = await aiInstance.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{text: prompt}, ...contextParts] },
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    questions: {
                        type: Type.ARRAY,
                        items: quizQuestionSchema,
                    },
                },
            },
        },
    });

    const jsonText = response.text;
    try {
        const parsed = JSON.parse(jsonText);
        return parsed.questions as QuizQuestion[];
    } catch (e) {
        console.error("Failed to parse quiz JSON:", e);
        throw new Error("The AI returned an invalid quiz format.");
    }
}

const flashcardSchema = {
    type: Type.OBJECT,
    properties: {
        term: { type: Type.STRING, description: 'A question, key term, or concept for the front of the flashcard. Should be concise.' },
        definition: { type: Type.STRING, description: 'A comprehensive but clear answer or explanation for the back of the flashcard.' },
        pageNum: { type: Type.NUMBER, description: 'The page number where this term is most relevant or first introduced.' },
    },
    required: ['term', 'definition', 'pageNum'],
};

export async function generateFlashcards(contextParts: Part[], numFlashcards: number): Promise<Omit<Flashcard, 'id' | 'docId'>[]> {
    const aiInstance = getAiInstance();
    const prompt = `You are an expert study guide creator. Your task is to create ${numFlashcards} highly effective flashcards based on the provided document content. These flashcards should go beyond simple definitions. Focus on:
- Core concepts and their significance.
- Cause-and-effect relationships.
- Key figures and their contributions.
- Critical comparisons or contrasts presented in the text.

For each flashcard, provide a clear "term" (which can be a question) and a comprehensive "definition" (the answer). Also, pinpoint the page number where the concept is most clearly explained.`;
    
    const response = await aiInstance.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{text: prompt}, ...contextParts] },
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    flashcards: {
                        type: Type.ARRAY,
                        items: flashcardSchema,
                    },
                },
            },
        },
    });

    const jsonText = response.text;
    try {
        const parsed = JSON.parse(jsonText);
        return parsed.flashcards as Omit<Flashcard, 'id' | 'docId'>[];
    } catch (e) {
        console.error("Failed to parse flashcards JSON:", e, "Raw text:", jsonText);
        throw new Error("The AI returned an invalid flashcard format.");
    }
}


export function startPageChatSession(contextParts: Part[]): Chat {
    const systemInstruction = `You are a helpful study assistant. Your knowledge is strictly limited to the context provided in the first user message. This context may include text and images. Base your answers ONLY on this provided context. If the answer isn't in the context, state that you don't have the information. Do not use outside knowledge. Please format your answers for clear readability. Use standard Markdown for lists (using asterisks) and bolding (using double asterisks). Avoid using LaTeX or other complex syntax. For example, instead of '$\\ge$', use '>=' or 'greater than or equal to'.`;
    
    const history = [
        { role: 'user' as const, parts: [{ text: "Please analyze the following document content. This is the sole source of information for my questions." }, ...contextParts] },
        { role: 'model' as const, parts: [{text: "I understand. I have loaded the document content and am ready to answer your questions based only on this material."}] }
    ];

    const aiInstance = getAiInstance();
    return aiInstance.chats.create({ model: 'gemini-2.5-flash', history, config: { systemInstruction } });
}

const recordAnswerFunctionDeclaration: FunctionDeclaration = {
  name: 'recordAnswer',
  parameters: {
    type: Type.OBJECT,
    description: 'Records whether the user answered a question correctly or incorrectly.',
    properties: {
      isCorrect: { type: Type.BOOLEAN, description: 'True if the user answered correctly, false otherwise.' },
      topic: { type: Type.STRING, description: 'A brief description of the question topic.' }
    },
    required: ['isCorrect', 'topic']
  }
};

export async function startReviewConversation({ contextParts, onMessage, onError, onClose }: { contextParts: Part[]; onMessage: (message: LiveServerMessage) => void; onError: (error: any) => void; onClose: () => void; }) {
    const systemInstruction = `You are a friendly and encouraging study coach. The user has provided you with content from a document. Your task is to help them review it through a spoken conversation.
1.  Start by greeting the user and asking them to summarize the content in their own words.
2.  Listen to their summary carefully. Be sure to analyze any images provided.
3.  After their summary, ask them probing questions about key details from the provided content to test their understanding.
4.  If they answer correctly, praise them. If they make a mistake, gently correct them by providing information from the document.
5.  After each of the user's answers, you MUST call the \`recordAnswer\` function to log their performance.
6.  Keep the conversation interactive. Ask one question at a time.
Your responses will be spoken, so keep them conversational and not too long.`;
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);
    const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
    
    const aiInstance = getAiInstance();
    const sessionPromise = aiInstance.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                scriptProcessor.onaudioprocess = (audioProcessingEvent: AudioProcessingEvent) => {
                    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                    const int16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                    sessionPromise.then((session) => session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } })).catch(onError);
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(context.destination);
            },
            onmessage: onMessage,
            onerror: (e: ErrorEvent) => { console.error('Live session error:', e); onError(e); },
            onclose: (e: CloseEvent) => { console.debug('Live session closed'); onClose(); }
        },
        config: {
            systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: 'Puck' }
                }
            },
            tools: [{functionDeclarations: [recordAnswerFunctionDeclaration]}]
        },
        initialInput: { contents: contextParts }
    });

    const session = await sessionPromise;
    return { session, stream, context, scriptProcessor, source };
}

const recallAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        score: {
            type: Type.OBJECT,
            properties: {
                recall: { type: Type.NUMBER, description: 'A score from 0-100 representing how much of the key information the user mentioned.' },
                accuracy: { type: Type.NUMBER, description: 'A score from 0-100 representing how accurate the user\'s statements were compared to the document.' },
            },
            required: ['recall', 'accuracy'],
        },
        feedback: { type: Type.STRING, description: 'A paragraph of constructive feedback for the user, summarizing their performance and suggesting areas for improvement.' },
        missedPoints: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    topic: { type: Type.STRING, description: 'A short, one or two-word topic for the missed point (e.g., "Mitochondria\'s Function").' },
                    quoteFromDocument: { type: Type.STRING, description: 'A brief, verbatim quote from the source document that illustrates the missed point.' },
                    pageNum: { type: Type.NUMBER, description: 'The page number where this quote can be found.' },
                },
                required: ['topic', 'quoteFromDocument', 'pageNum'],
            },
            description: 'An array of 3-5 key concepts the user failed to mention.'
        }
    },
    required: ['score', 'feedback', 'missedPoints'],
};


export async function analyzeRecall(contextParts: Part[], userSummary: string): Promise<RecallAnalysisResult> {
    const aiInstance = getAiInstance();
    const prompt = `You are a study assessment AI. Your task is to analyze a user's spoken summary against a source document. The document content, including page numbers, is provided first. This is followed by the user's transcribed summary.

Analyze the user's summary based *only* on the provided document content.

Your analysis should perform the following steps:
1.  **Evaluate Recall and Accuracy:** Compare the user's summary to the key points in the document. Assign a score from 0-100 for recall (how much key information was covered) and accuracy (how correct the information was).
2.  **Provide Constructive Feedback:** Write a helpful, encouraging paragraph summarizing what the user did well and where they can improve.
3.  **Identify Missed Key Points:** Find 3-5 of the most important concepts or facts from the document that the user did not mention. For each missed point, provide a short topic, a direct quote from the document illustrating the point, and the page number where that quote is located.

The user's summary is:
---
${userSummary}
---
`;
    
    const response = await aiInstance.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{text: prompt}, ...contextParts] },
        config: {
            responseMimeType: 'application/json',
            responseSchema: recallAnalysisSchema,
        },
    });

    const jsonText = response.text;
    try {
        return JSON.parse(jsonText) as RecallAnalysisResult;
    } catch (e) {
        console.error("Failed to parse recall analysis JSON:", e, "Raw text:", jsonText);
        throw new Error("The AI returned an invalid analysis format.");
    }
}