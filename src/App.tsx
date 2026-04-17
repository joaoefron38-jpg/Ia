import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mic, MicOff, Volume2, Sparkles, Bot, Loader2, Info, Settings, 
  X, Palette, Clock, Sliders, Check, RotateCcw, MessageSquare
} from "lucide-react";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Constants for Audio
const SAMPLING_RATE = 24000;
const CHUNK_SIZE = 4096;

// Themes Definition
const THEMES = [
  { id: 'emerald', name: 'Esmeralda', color: '#10b981', bg: 'bg-emerald-500' },
  { id: 'cyber', name: 'Cyber', color: '#06b6d4', bg: 'bg-cyan-500' },
  { id: 'royal', name: 'Royal', color: '#f59e0b', bg: 'bg-amber-500' },
  { id: 'crimson', name: 'Crimson', color: '#ef4444', bg: 'bg-red-500' },
  { id: 'lavender', name: 'Lavender', color: '#a855f7', bg: 'bg-purple-500' },
  { id: 'sunset', name: 'Sunset', color: '#f97316', bg: 'bg-orange-500' },
  { id: 'ocean', name: 'Ocean', color: '#3b82f6', bg: 'bg-blue-500' },
  { id: 'forest', name: 'Forest', color: '#22c55e', bg: 'bg-green-500' },
  { id: 'mono', name: 'Mono', color: '#f8fafc', bg: 'bg-slate-100' },
  { id: 'neon', name: 'Neon', color: '#ec4899', bg: 'bg-pink-500' },
  { id: 'midnight', name: 'Midnight', color: '#6366f1', bg: 'bg-indigo-500' },
];

interface AppSettings {
  themeId: string;
  customColor: string;
  voiceName: string;
  sensitivity: number;
}

export default function App() {
  // UI State
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [volume, setVolume] = useState(0);

  // Settings State
  const [settings, setSettings] = useState<AppSettings>({
    themeId: 'emerald',
    customColor: '#10b981',
    voiceName: 'Zephyr',
    sensitivity: 1.0
  });

  // Refs for Audio & Session
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueue = useRef<Int16Array[]>([]);
  const nextStartTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentTheme = useMemo(() => 
    THEMES.find(t => t.id === settings.themeId) || THEMES[0]
  , [settings.themeId]);

  const activeColor = settings.themeId === 'custom' ? settings.customColor : currentTheme.color;

  // Initialize Audio Context
  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: SAMPLING_RATE });
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  };

  // Improved Playback logic for PCM (Gapless)
  const isPlayingLoopRef = useRef(false);
  const playNextChunk = useCallback(async () => {
    if (audioQueue.current.length === 0 || !audioContextRef.current || isPlayingLoopRef.current) {
      return;
    }

    isPlayingLoopRef.current = true;

    while (audioQueue.current.length > 0 && audioContextRef.current) {
      const pcmData = audioQueue.current.shift()!;
      const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, SAMPLING_RATE);
      const channelData = audioBuffer.getChannelData(0);
      
      for (let i = 0; i < pcmData.length; i++) {
        channelData[i] = pcmData[i] / 32768.0;
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = 1.0;
      source.connect(audioContextRef.current.destination);
      
      const now = audioContextRef.current.currentTime;
      if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now + 0.05;
      }
      
      source.start(nextStartTimeRef.current);
      const duration = audioBuffer.duration;
      nextStartTimeRef.current += duration;

      // Small delay to allow other tasks to run
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    isPlayingLoopRef.current = false;
  }, []);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setIsActive(false);
    setIsConnecting(false);
    setVolume(0);
    setUserTranscript("");
    setAiTranscript("");
    audioQueue.current = [];
    nextStartTimeRef.current = 0;
    isPlayingLoopRef.current = false;
  }, []);

  const startSession = async () => {
    try {
      setIsConnecting(true);
      await initAudio();

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName } },
          },
          systemInstruction: `Você é a efRon IA, uma inteligência artificial de elite criada pelo seu usuário. Você interage exclusivamente por voz e é capaz de falar todos os idiomas do mundo, respondendo sempre no idioma em que for questionada de forma natural e fluída. Seja breve, amigável e extremamente prestativa. Responda a todas as perguntas com precisão e velocidade normal. Sua plataforma é a efRon IA. Evite pausas longas e seja direta.`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: async () => {
            setIsActive(true);
            setIsConnecting(false);
            
            // Start Mic
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = audioContextRef.current!.createMediaStreamSource(streamRef.current);
            processorRef.current = audioContextRef.current!.createScriptProcessor(CHUNK_SIZE, 1, 1);
            
            processorRef.current.onaudioprocess = (e) => {
              if (isMuted) return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              let sum = 0;
              
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                // Apply sensitivity
                const boosted = s * settings.sensitivity;
                const clamped = Math.max(-1, Math.min(1, boosted));
                pcmData[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
                sum += Math.abs(clamped);
              }
              
              setVolume(sum / inputData.length);

              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              sessionRef.current?.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=24000' }
              });
            };

            source.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcmData = new Int16Array(bytes.buffer);
              audioQueue.current.push(pcmData);
              playNextChunk();
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              audioQueue.current = [];
              nextStartTimeRef.current = 0;
            }

            // Handle Transcriptions
            if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
              setAiTranscript(prev => (prev + " " + message.serverContent?.modelTurn?.parts?.[0]?.text).slice(-150));
            }
            
            // User transcription
            const userText = (message.serverContent as any)?.userTurn?.parts?.[0]?.text;
            if (userText) {
              setUserTranscript(prev => (prev + " " + userText).slice(-100));
            }
          },
          onclose: () => stopSession(),
          onerror: (e) => {
            console.error("Live API Error:", e);
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (error) {
      console.error("Failed to start session:", error);
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 items-center justify-center p-6 overflow-hidden relative">
      {/* Background Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[140px] transition-all duration-1000 opacity-40"
          style={{ backgroundColor: `${activeColor}20` }}
        />
      </div>

      {/* Header */}
      <div className="absolute top-8 left-8 right-8 flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <motion.div 
            animate={{ rotate: isActive ? [0, 5, -5, 0] : 0 }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl glass"
            style={{ backgroundColor: `${activeColor}20` }}
          >
            <Bot style={{ color: activeColor }} className="w-8 h-8" />
          </motion.div>
          <div>
            <h1 className="font-extrabold text-3xl tracking-tighter text-gradient">efRon IA</h1>
            <div className="flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", isActive ? "bg-emerald-500 animate-pulse" : "bg-zinc-700")} />
              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-black">
                {isActive ? "Sessão Ativa" : "Sistema Pronto"}
              </p>
            </div>
          </div>
        </div>

        <button 
          onClick={() => setShowSettings(true)}
          className="w-12 h-12 flex items-center justify-center glass rounded-2xl transition-all hover:scale-110 text-zinc-400 hover:text-white"
        >
          <Settings size={22} />
        </button>
      </div>

      {/* Main Visualizer & Bot Animation */}
      <div className="relative flex flex-col items-center gap-16 z-10 w-full max-w-lg">
        {/* Transcription Display (Top) */}
        <div className="h-20 w-full flex flex-col items-center justify-end overflow-hidden">
          <AnimatePresence mode="wait">
            {userTranscript && (
              <motion.p 
                key={userTranscript}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-zinc-400 text-sm text-center font-medium line-clamp-2 px-4"
              >
                {userTranscript}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Bot Visualizer */}
        <div className="relative">
          <motion.div 
            animate={{ 
              y: isActive ? [0, -15, 0] : 0,
              scale: isActive ? [1, 1.05, 1] : 1,
              rotate: isActive ? [0, 1, -1, 0] : 0
            }}
            transition={{ 
              duration: isActive ? (2 - (volume * 1.5)) : 4, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            className="relative z-20"
          >
            {/* Pulsing Rings */}
            <AnimatePresence>
              {isActive && !isMuted && (
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <motion.div 
                      key={i}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ 
                        scale: 1 + (i * 0.3) + (volume * (i * 4)), 
                        opacity: (0.4 / i) + (volume * 0.5),
                        borderColor: activeColor,
                        borderWidth: 1 + (volume * 4)
                      }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="absolute inset-0 rounded-full border-2 pointer-events-none"
                      style={{ transition: 'border-color 0.5s ease, border-width 0.1s ease' }}
                    />
                  ))}
                </>
              )}
            </AnimatePresence>

            {/* Central Bot Orb */}
            <button
              onClick={isActive ? stopSession : startSession}
              disabled={isConnecting}
              className={cn(
                "w-64 h-64 rounded-[60px] flex items-center justify-center transition-all duration-700 relative z-30 group overflow-hidden",
                isActive 
                  ? "text-zinc-950" 
                  : "bg-zinc-900/50 backdrop-blur-md border-2 border-zinc-800 text-zinc-400 hover:border-zinc-700"
              )}
              style={{ 
                backgroundColor: isActive ? activeColor : undefined,
                boxShadow: isActive ? `0 0 80px ${activeColor}60` : `0 0 20px rgba(0,0,0,0.5)`
              }}
            >
              {isConnecting ? (
                <Loader2 className="w-16 h-16 animate-spin" />
              ) : isActive ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex gap-3 mb-2">
                    <motion.div 
                      animate={{ 
                        height: [20, 20, 4, 20, 20],
                        scaleY: [1, 1, 0.1, 1, 1],
                        scaleX: [1, 1.2, 1, 1.2, 1]
                      }}
                      transition={{ 
                        duration: 3, 
                        repeat: Infinity, 
                        times: [0, 0.45, 0.5, 0.55, 1],
                        delay: Math.random() * 2
                      }}
                      className="w-3 bg-zinc-950 rounded-full"
                    />
                    <motion.div 
                      animate={{ 
                        height: [20, 20, 4, 20, 20],
                        scaleY: [1, 1, 0.1, 1, 1],
                        scaleX: [1, 1.2, 1, 1.2, 1]
                      }}
                      transition={{ 
                        duration: 3, 
                        repeat: Infinity, 
                        times: [0, 0.45, 0.5, 0.55, 1],
                        delay: Math.random() * 2
                      }}
                      className="w-3 bg-zinc-950 rounded-full"
                    />
                  </div>
                  
                  {/* Voice Waveform inside Orb */}
                  <div className="flex items-center gap-1 h-6">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <motion.div 
                        key={i}
                        animate={{ 
                          height: [4, 4 + (volume * 40), 4],
                          opacity: [0.5, 1, 0.5]
                        }}
                        transition={{ 
                          duration: 0.15, 
                          repeat: Infinity, 
                          delay: i * 0.03 
                        }}
                        className="w-1 bg-zinc-950 rounded-full"
                      />
                    ))}
                  </div>

                  <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-80">Encerrar</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6 group-hover:scale-110 transition-transform">
                  <div className="relative">
                    <Mic className="w-16 h-16" />
                    <motion.div 
                      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -inset-4 border border-white/10 rounded-full"
                    />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-[0.3em]">Falar com efRon</span>
                </div>
              )}

              {/* Scanline Effect */}
              {isActive && (
                <motion.div 
                  animate={{ top: ['-100%', '200%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 bg-gradient-to-b from-transparent via-white/10 to-transparent h-20 w-full pointer-events-none"
                />
              )}
            </button>
          </motion.div>
        </div>

        {/* AI Transcription Display (Bottom) */}
        <div className="h-24 w-full flex flex-col items-center justify-start">
          <AnimatePresence mode="wait">
            <motion.div
              key={aiTranscript}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <p className="text-lg font-light tracking-tight text-white leading-relaxed line-clamp-3 italic">
                {aiTranscript || (isActive ? "Aguardando resposta..." : "Toque no botão para iniciar a efRon IA")}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Controls Bar */}
      <AnimatePresence>
        {isActive && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="absolute bottom-12 flex items-center gap-4 bg-zinc-900/40 backdrop-blur-2xl border border-zinc-800/50 p-2 rounded-3xl z-20"
          >
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center transition-all",
                isMuted ? "bg-red-500 text-white" : "hover:bg-zinc-800 text-zinc-400"
              )}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <div className="w-px h-8 bg-zinc-800" />
            <div className="px-6 py-2 flex items-center gap-3">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <motion.div 
                    key={i}
                    animate={{ height: isActive && !isMuted ? [4, 12 + (volume * 40), 4] : 4 }}
                    transition={{ duration: 0.2, repeat: Infinity, delay: i * 0.05 }}
                    className="w-1 rounded-full"
                    style={{ backgroundColor: activeColor }}
                  />
                ))}
              </div>
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Live</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-zinc-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass-dark w-full max-w-2xl rounded-[40px] overflow-hidden shadow-2xl border-white/10"
            >
              <div className="p-10 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl glass flex items-center justify-center">
                    <Settings className="text-zinc-400" size={20} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Personalize sua efRon IA</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-10 space-y-12 max-h-[60vh] overflow-y-auto">
                {/* Theme Selection */}
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Palette size={16} />
                      <h3 className="text-xs font-black uppercase tracking-[0.2em]">Temas Premium</h3>
                    </div>
                    <span className="text-[10px] font-bold text-zinc-600 bg-zinc-800/50 px-2 py-1 rounded-md">11 OPÇÕES</span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-4">
                    {THEMES.map(theme => (
                      <button
                        key={theme.id}
                        onClick={() => setSettings(s => ({ ...s, themeId: theme.id }))}
                        className={cn(
                          "group relative flex flex-col items-center gap-3 p-2 rounded-2xl transition-all",
                          settings.themeId === theme.id ? "bg-white/10 scale-105" : "hover:bg-white/5"
                        )}
                      >
                        <div className={cn("w-10 h-10 rounded-full shadow-2xl border-2 border-white/10", theme.bg)} />
                        <span className="text-[9px] font-black uppercase tracking-tighter truncate w-full text-center opacity-60 group-hover:opacity-100">{theme.name}</span>
                        {settings.themeId === theme.id && (
                          <motion.div layoutId="activeTheme" className="absolute inset-0 border-2 border-white/20 rounded-2xl pointer-events-none" />
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  {/* Voice Selection */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <MessageSquare size={16} />
                      <h3 className="text-xs font-black uppercase tracking-[0.2em]">Personalidade Vocal</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'].map(v => (
                        <button
                          key={v}
                          onClick={() => setSettings(s => ({ ...s, voiceName: v }))}
                          className={cn(
                            "px-4 py-3 rounded-xl text-xs font-bold transition-all border",
                            settings.voiceName === v 
                              ? "bg-white text-zinc-950 border-white" 
                              : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10"
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Sensitivity */}
                  <section className="space-y-6">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Sliders size={16} />
                      <h3 className="text-xs font-black uppercase tracking-[0.2em]">Sensibilidade Mic</h3>
                    </div>
                    <div className="space-y-4">
                      <input 
                        type="range" 
                        min="0.5" 
                        max="3.0" 
                        step="0.1"
                        value={settings.sensitivity}
                        onChange={(e) => setSettings(s => ({ ...s, sensitivity: parseFloat(e.target.value) }))}
                        className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-white"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-zinc-600">BAIXA</span>
                        <span className="text-2xl font-black tracking-tighter">{settings.sensitivity.toFixed(1)}x</span>
                        <span className="text-[10px] font-bold text-zinc-600">ALTA</span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div className="p-10 glass flex items-center justify-between border-t border-white/5">
                <button 
                  onClick={() => setSettings({
                    themeId: 'emerald',
                    customColor: '#10b981',
                    voiceName: 'Zephyr',
                    sensitivity: 1.0
                  })}
                  className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                >
                  <RotateCcw size={12} /> Resetar Padrões
                </button>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-10 py-4 bg-white text-zinc-950 rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:scale-105 transition-transform shadow-2xl shadow-white/10"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[10px] text-zinc-800 uppercase tracking-widest font-bold pointer-events-none">
        <Sparkles size={12} />
        <span>efRon IA v2.3 • Powered by Gemini Live</span>
      </div>
    </div>
  );
}
