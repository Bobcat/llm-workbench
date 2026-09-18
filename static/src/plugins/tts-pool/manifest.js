// TTS Pool console: model administration through tts-pool.
export default {
  id: 'tts-pool',
  label: 'TTS Pool',
  views: [
    {
      id: 'tts-pool-models',
      route: 'tts-pool-models',
      name: 'Models',
      tooltip: 'TTS pool models',
      icon: 'pool-tts',
      persistent: true,
      module: 'src/workflows/tts-pool/index.js',
      factory: 'createTtsPoolView',
    },
  ],
};
