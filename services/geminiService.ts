import { GoogleGenAI, Modality, LiveServerMessage, Chat, Part } from "@google/genai";
import { encode } from '../utils/audio';

// The AI instance will be created, but API calls will fail if the key is missing.
// This failure is handled gracefully in the UI components.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export function startPageChatSession(contextParts: Part[]): Chat {
    const systemInstruction = `You are a helpful study assistant. Your knowledge is strictly limited to the context provided in the first user message. This context may include text and images. Base your answers ONLY on this provided context. If the answer isn't in the context, state that you don't have the information. Do not use outside knowledge. Please format your answers for clear readability. Use standard Markdown for lists (using asterisks) and bolding (using double asterisks). Avoid using LaTeX or other complex syntax. For example, instead of '$\\ge$', use '>=' or 'greater than or equal to'.`;
    
    const history = [
        {
            role: 'user' as const,
            parts: [
                { text: "Please analyze the following document content, which includes page markers and may contain images with text. This is the sole source of information for my questions." }, 
                ...contextParts
            ]
        },
        {
            role: 'model' as const,
            parts: [{text: "I understand. I have loaded the document content. I am ready to answer your questions based only on this material."}]
        }
    ];

    return ai.chats.create({
      model: 'gemini-2.5-flash',
      history: history,
      config: {
        systemInstruction,
      },
    });
}

export async function startReviewConversation({ 
    contextParts, 
    onMessage, 
    onError, 
    onClose 
}: {
    contextParts: Part[];
    onMessage: (message: LiveServerMessage) => void;
    onError: (error: any) => void;
    onClose: () => void;
}) {
    const systemInstruction = `You are a friendly and encouraging study coach. The user has provided you with content from a document, which includes text and images of document pages. Your task is to help them review it through a spoken conversation.
1.  Start by greeting the user and asking them to summarize the content in their own words.
2.  Listen to their summary carefully. Be sure to analyze the images provided, as they may contain important charts, diagrams, or text not available in the extracted text.
3.  After their summary, ask them probing questions about key details, definitions, and concepts from the provided content to test their understanding.
4.  If they answer correctly, praise them. If they make a mistake or are unsure, gently correct them by providing information or quotes from the document content.
5.  Keep the conversation interactive. Ask one question at a time.
6.  Your goal is to ensure the user has a solid understanding of the material.
Your responses will be spoken, so keep them conversational and not too long.`;
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);
    const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
    
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                scriptProcessor.onaudioprocess = (audioProcessingEvent: AudioProcessingEvent) => {
                    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                    const l = inputData.length;
                    const int16 = new Int16Array(l);
                    for (let i = 0; i < l; i++) {
                        int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                    }
                    const pcmBlob = {
                        data: encode(new Uint8Array(int16.buffer)),
                        mimeType: 'audio/pcm;rate=16000',
                    };
                    sessionPromise.then((session) => {
                        session.sendRealtimeInput({ media: pcmBlob });
                    }).catch(onError);
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(context.destination);
            },
            onmessage: onMessage,
            onerror: (e: ErrorEvent) => {
                console.error('Live session error:', e);
                onError(e);
            },
            onclose: (e: CloseEvent) => {
                console.debug('Live session closed');
                onClose();
            },
        },
        config: {
            systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            responseModalities: [Modality.AUDIO],
        },
        initialInput: {
            contents: contextParts,
        }
    });

    const session = await sessionPromise;
    
    return { session, stream, context, scriptProcessor, source };
}

export async function createLiveSession({
    onTranscriptionUpdate,
    onTurnComplete,
    onError,
    onClose
}: {
    onTranscriptionUpdate: (textChunk: string) => void;
    onTurnComplete: () => void;
    onError: (error: any) => void;
    onClose: () => void;
}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);
    const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
    
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                scriptProcessor.onaudioprocess = (audioProcessingEvent: AudioProcessingEvent) => {
                    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                    const l = inputData.length;
                    const int16 = new Int16Array(l);
                    for (let i = 0; i < l; i++) {
                        int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                    }
                    const pcmBlob = {
                        data: encode(new Uint8Array(int16.buffer)),
                        mimeType: 'audio/pcm;rate=16000',
                    };
                    sessionPromise.then((session) => {
                        session.sendRealtimeInput({ media: pcmBlob });
                    }).catch(onError);
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(context.destination);
            },
            onmessage: (message: LiveServerMessage) => {
                if (message.serverContent?.inputTranscription) {
                    onTranscriptionUpdate(message.serverContent.inputTranscription.text);
                }
                if (message.serverContent?.turnComplete) {
                    onTurnComplete();
                }
            },
            onerror: (e: ErrorEvent) => {
                console.error('Live transcription session error:', e);
                onError(e);
            },
            onclose: (e: CloseEvent) => {
                console.debug('Live transcription session closed');
                onClose();
            },
        },
        config: {
            inputAudioTranscription: {},
        },
    });

    const session = await sessionPromise;
    
    return { session, stream, context, scriptProcessor, source };
}