import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import type { ReviewResult } from '../types';
import { encode } from '../utils/audio';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const reviewSchema = {
    type: Type.OBJECT,
    properties: {
        score: {
            type: Type.INTEGER,
            description: "A comprehension score from 0 to 100 based on the user's summary."
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
                    }
                },
                required: ["point", "example", "suggestion"]
            }
        }
    },
    required: ["score", "summaryOfMentionedPoints", "reviewOfMissedPoints"]
};

export async function getReview(documentText: string, userSummary: string): Promise<ReviewResult> {
  const prompt = `
    Here is the original document content:
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
    3.  Provide a brief, positive summary of the key points the user correctly mentioned.
    4.  Identify the key points or important details from the original document that the user missed in their summary. For each missed point, provide a specific, brief quote or example from the original document that directly illustrates it.
    5.  For each missed point, also provide an actionable suggestion to help the user improve. This could be a recommendation to review a specific section, a related concept to study, or a question to consider that would lead them to the correct understanding.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: reviewSchema,
    },
  });

  try {
    const jsonString = response.text;
    const result = JSON.parse(jsonString);
    return result as ReviewResult;
  } catch (e) {
    console.error("Failed to parse Gemini response:", e);
    throw new Error("The AI returned an invalid response. Please try again.");
  }
}

const workletCode = `
class AudioSenderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const pcmData = input[0];
      if (pcmData) {
        // Post the Float32Array back to the main thread.
        this.port.postMessage(pcmData);
      }
    }
    return true; // Keep the processor alive.
  }
}
registerProcessor('audio-sender-processor', AudioSenderProcessor);
`;


interface LiveSessionCallbacks {
    onTranscriptionUpdate: (textChunk: string) => void;
    onTurnComplete: () => void;
    onError: (error: ErrorEvent) => void;
}

export async function createLiveSession(callbacks: LiveSessionCallbacks) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Using AudioWorklet for better performance
    const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = context.createMediaStreamSource(stream);

    const workletBlob = new Blob([workletCode], { type: 'application/javascript' });
    const workletURL = URL.createObjectURL(workletBlob);
    await context.audioWorklet.addModule(workletURL);
    
    const workletNode = new AudioWorkletNode(context, 'audio-sender-processor');
    source.connect(workletNode).connect(context.destination);

    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => {
                console.log('Live session opened.');
                workletNode.port.onmessage = (event) => {
                    const pcmData = event.data; // Float32Array from worklet
                    const l = pcmData.length;
                    const int16 = new Int16Array(l);
                    for (let i = 0; i < l; i++) {
                        // Clamp values to avoid issues
                        int16[i] = Math.max(-32768, Math.min(32767, pcmData[i] * 32768));
                    }
                    const pcmBlob = {
                        data: encode(new Uint8Array(int16.buffer)),
                        mimeType: 'audio/pcm;rate=16000',
                    };

                    sessionPromise.then((session) => {
                       if(session) session.sendRealtimeInput({ media: pcmBlob });
                    });
                };
            },
            onmessage: (message: LiveServerMessage) => {
                if (message.serverContent?.inputTranscription) {
                    const text = message.serverContent.inputTranscription.text;
                    callbacks.onTranscriptionUpdate(text);
                }
                if (message.serverContent?.turnComplete) {
                    callbacks.onTurnComplete();
                }
            },
            onerror: (e: ErrorEvent) => callbacks.onError(e),
            onclose: () => console.log('Live session closed.'),
        },
        config: {
            inputAudioTranscription: { enableAutomaticPunctuation: true },
        },
    });

    const session = await sessionPromise;
    // Return objects needed for cleanup
    return { session, stream, context, workletNode, source };
}