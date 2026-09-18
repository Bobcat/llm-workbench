// Realtime TTS playground: replay committed transcript segments through tts-pool.
export default {
  id: 'realtime-tts',
  label: 'Realtime TTS',
  views: [
    {
      id: 'replay-speak',
      route: 'replay-speak',
      name: 'Replay & Speak',
      icon: 'volume-2',
      persistent: true,
      module: 'src/workflows/replay-speak/index.js',
      factory: 'createReplaySpeakView',
    },
  ],
};
