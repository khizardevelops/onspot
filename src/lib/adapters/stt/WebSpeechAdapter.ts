import { BaseSTTAdapter } from './BaseAdapter';
import type { ModelConfig, ModelProgress, TranscribeOptions } from '../../types';

export class WebSpeechAdapter extends BaseSTTAdapter {
  constructor() {
    const config: ModelConfig = {
      id: 'web-speech-api',
      name: 'Web Speech API (fr-FR)',
      description: 'Browser native speech recognition engine (Zero download size, instant response)',
      provider: 'Browser Native',
      modelRepoId: 'browser-native/speech-recognition',
      parameterCount: 'N/A (Browser)',
      quantizedSize: '0 MB (Built-in)',
      language: 'French (fr-FR)',
      status: 'unloaded'
    };
    super(config);
  }

  public isSupported(): boolean {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  public async load(onProgress?: (progress: ModelProgress) => void): Promise<void> {
    if (onProgress) this.onProgressCallback = onProgress;
    if (!this.isSupported()) {
      this.setStatus('error', 'Web Speech API is not supported in this browser');
      throw new Error('Web Speech API is not supported in this browser');
    }

    this.setStatus('loading');
    this.updateProgress('Initializing native browser engine...', 50);
    this.setStatus('ready');
    this.updateProgress('Web Speech API ready', 100);
  }

  public async doTranscribe(
    audio16kMono: Float32Array,
    durationSec: number,
    options?: TranscribeOptions
  ): Promise<string> {
    if (!this.isSupported()) {
      throw new Error('Web Speech API not supported');
    }

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionClass();

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = options?.language || 'fr-FR';

    return new Promise((resolve, reject) => {
      let finalTranscript = '';
      let hasResponded = false;

      const timeout = setTimeout(() => {
        if (!hasResponded) {
          hasResponded = true;
          try { recognition.stop(); } catch (e) {}
          resolve(finalTranscript || '[Native Speech Recognition timed out or no speech detected]');
        }
      }, Math.max(5000, durationSec * 1000 + 2000));

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (!hasResponded) {
          hasResponded = true;
          clearTimeout(timeout);
          resolve(`[Native API Error: ${event.error || 'Speech error'}]`);
        }
      };

      recognition.onend = () => {
        if (!hasResponded) {
          hasResponded = true;
          clearTimeout(timeout);
          resolve(finalTranscript.trim() || '[No speech detected by Native Browser API]');
        }
      };

      try {
        recognition.start();
      } catch (err: any) {
        clearTimeout(timeout);
        resolve(`[Native API Start Error: ${err?.message || err}]`);
      }
    });
  }
}
