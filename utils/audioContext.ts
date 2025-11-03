let audioContext: AudioContext | null = null;

const sampleRate = 24000;

/**
 * Returns a shared AudioContext instance.
 * Creates a new one if it doesn't exist or if the previous one was closed.
 */
export function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
    } catch (e) {
      console.error("Failed to create AudioContext:", e);
      // Fallback for browsers that might not support options
      if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    }
  }
  
  // Resume context if it's suspended (e.g., due to browser auto-play policies)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  return audioContext;
}