import { GoogleGenAI, Modality, LiveServerMessage, Chat, Part, FunctionDeclaration, Type } from "@google/genai";
import { encode } from '../utils/audio';
import { QuizQuestion } from "../types";

let ai: GoogleGenAI | null = null;

function getAiInstance(): GoogleGenAI {
    if (!ai) {
        if (typeof process === 'undefined' || !process.env.API_KEY) {
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

export async function generateQuiz(contextParts: Part[]): Promise<QuizQuestion[]> {
    const aiInstance = getAiInstance();
    const prompt = `Based on the following document content (text and images), generate 5 distinct multiple-choice questions to test understanding of the key concepts. Each question should have 4 options, with only one correct answer. Ensure the questions cover different topics from the text.`;
    
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