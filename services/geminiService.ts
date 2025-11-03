import { GoogleGenAI, Type, Modality, LiveServerMessage, Chat } from "@google/genai";
import type { ReviewResult } from '../types';
import { encode } from '../utils/audio';

// The AI instance will be created, but API calls will fail if the key is missing.
// This failure is handled gracefully in the UI components.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const reviewSchema = {
    type: Type.OBJECT,
    properties: {
        score: {
            type: Type.INTEGER,
            description: "A comprehension score from 0 to 100 based on the user's summary."
        },
        scoreRationale: {
            type: Type.STRING,
            description: "A brief, one-sentence rationale explaining the score. For example: 'Your score reflects a good grasp of the main topics, but you missed several key definitions.'"
        },
        summaryOfMentionedPoints: {
            type: Type.STRING,
            description: "A concise summary of the key points the user correctly identified in their review."
        },
        reviewOfMissedPoints: {
            type: Type.ARRAY,
            description: "A list of objects, where each object contains a key point the user missed, a direct quote from the document, and an actionable suggestion for improvement.",
            items: {
                type: Type.OBJECT,
                properties: {
                    point: {
                        type: Type.STRING,
                        description: "The key point or important detail from the original document that the user failed to mention."
                    },
                    example: {
                        type: Type.STRING,
                        description: "A specific, brief quote or example from the original document that illustrates the missed point."
                    },
                    suggestion: {
                        type: Type.STRING,
                        description: "Actionable advice or a related topic for further study based on the missed point. For example, if a user missed a detail about photosynthesis, suggest they review 'the Calvin Cycle'."
                    },
                    relatedConcepts: {
                        type: Type.ARRAY,
                        description: "A list of 2-3 related concepts or keywords that the user could study to deepen their understanding of the missed point.",
                        items: {
                            type: Type.STRING
                        }
                    },
                    pageNumber: {
                        type: Type.INTEGER,
                        description: "The page number from the original document (identified by '--- PAGE X ---' markers) where the 'example' quote is located."
                    }
                },
                required: ["point", "example", "suggestion", "relatedConcepts", "pageNumber"]
            }
        }
    },
    required: ["score", "scoreRationale", "summaryOfMentionedPoints", "reviewOfMissedPoints"]
};

export async function getReview(documentText: string, userSummary: string): Promise<ReviewResult> {
  const prompt = `
    Here is the original document content, which includes page markers (e.g., '--- PAGE 1 ---'):
    ---
    ${documentText}
    ---

    Here is the user's spoken summary of the document:
    ---
    ${userSummary}
    ---

    Please perform the following tasks and provide the output in the requested JSON format:
    1.  Compare the user's summary against the original document.
    2.  Calculate a comprehension score from 0 to 100, where 100 represents perfect comprehension and recall of all key points. The score should reflect how much of the original text's core information is present in the user's summary.
    3.  Provide a short, one-sentence rationale explaining the score. For example: "Your score reflects a good grasp of the main topics, but you missed several key definitions."
    4.  Provide a brief, positive summary of the key points the user correctly mentioned.
    5.  Identify the key points or important details from the original document that the user missed in their summary. It is very important that you identify several missed points. Even if the summary is good, there are always nuances or details that can be highlighted for improvement. Be critical in your analysis. For each missed point, provide:
        a. The missed point itself.
        b. A specific, brief quote or example from the original document that directly illustrates it.
        c. The page number where this quote appears, referencing the '--- PAGE X ---' markers in the text.
        d. An actionable suggestion to help the user improve. This could be a recommendation to review a specific section, a related concept to study, or a question to consider that would lead them to the correct understanding.
        e. A list of 2-3 'relatedConcepts'. These should be keywords or topics related to the missed point that the user can research for deeper understanding.
  `;
  try {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
        responseMimeType: "application/json",
        responseSchema: reviewSchema,
        },
    });

    const jsonString = response.text;
    const result = JSON.parse(jsonString);
    return result as ReviewResult;
  } catch (e) {
    console.error("Failed to get review from Gemini:", e);
    if (e instanceof Error && e.message.includes('fetch')) {
        throw new Error("A network error occurred. Please check your connection and try again.");
    }
    throw new Error("The AI returned an invalid response or an error occurred. Please try again.");
  }
}

export function startPageChatSession(contextText: string): Chat {
    const systemInstruction = `You are a helpful study assistant. Your knowledge is strictly limited to the following text provided by the user. Answer the user's questions based only on this provided context. If the answer cannot be found in the text, clearly state that you do not have that information. Do not use any outside knowledge.

    --- DOCUMENT CONTEXT ---
    ${contextText}
    --- END OF CONTEXT ---`;
    
    return ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction,
      },
    });
}

export async function generateSpeech(text: string): Promise<string | null> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `Say with a helpful and clear tone: ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        return base64Audio || null;
    } catch (e) {
        console.error("Failed to generate speech:", e);
        // Do not throw here, as it's not a critical failure. The app can proceed without audio.
        return null;
    }
}

const workletCode = `
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channelData = inputs[0][0];
    if (channelData) {
      // Convert Float32Array to Int16Array and post back.
      const int16 = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        // Clamp the values to the Int16 range.
        int16[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
      }
      this.port.postMessage(int16);
    }
    return true; // Keep processor alive.
  }
}
registerProcessor('audio-processor', AudioProcessor);
`;

let workletURL: string | undefined;

export async function createLiveSession({ onTranscriptionUpdate, onTurnComplete, onError, onClose }: {
    onTranscriptionUpdate: (text: string) => void;
    onTurnComplete: () => void;
    onError: (error: any) => void;
    onClose: () => void;
}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);

    if (!workletURL) {
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      workletURL = URL.createObjectURL(blob);
    }
    
    await context.audioWorklet.addModule(workletURL);
    const workletNode = new AudioWorkletNode(context, 'audio-processor');
    
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                workletNode.port.onmessage = (event: MessageEvent<Int16Array>) => {
                    const pcmBlob = {
                        data: encode(new Uint8Array(event.data.buffer)),
                        mimeType: 'audio/pcm;rate=16000',
                    };
                    
                    sessionPromise.then((session) => {
                        session.sendRealtimeInput({ media: pcmBlob });
                    }).catch(onError);
                };
                source.connect(workletNode);
                workletNode.connect(context.destination);
            },
            onmessage: (message: LiveServerMessage) => {
                if (message.serverContent?.inputTranscription?.text) {
                    onTranscriptionUpdate(message.serverContent.inputTranscription.text);
                }
                if (message.serverContent?.turnComplete) {
                    onTurnComplete();
                }
            },
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
            inputAudioTranscription: {},
            responseModalities: [Modality.AUDIO],
        },
    });

    const session = await sessionPromise;
    
    return { session, stream, context, workletNode, source };
}