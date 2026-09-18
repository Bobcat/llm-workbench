// Realtime translation playground: replay .pc transcripts and inspect translation behaviour.
export default {
  id: 'realtime-translation',
  label: 'Realtime Translation',
  views: [
    {
      id: 'replay-translate',
      route: 'replay-translate',
      name: 'Replay & Translate',
      icon: 'languages',
      persistent: true,
      module: 'src/workflows/replay/index.js',
      factory: 'createReplayView',
    },
  ],
};
