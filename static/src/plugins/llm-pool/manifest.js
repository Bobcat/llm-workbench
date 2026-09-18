// LLM Pool console: model administration plus text generation and chat through llm-pool.
export default {
  id: 'llm-pool',
  label: 'LLM Pool',
  views: [
    {
      id: 'llm-pool-models',
      route: 'llm-pool-models',
      name: 'Models',
      tooltip: 'LLM pool models',
      icon: 'pool-llm',
      persistent: true,
      module: 'src/workflows/llm-pool/index.js',
      factory: 'createLlmPoolView',
    },
    {
      id: 'text-generation',
      route: 'text-generation',
      name: 'Text generation',
      icon: 'file-plus',
      persistent: true,
      module: 'src/workflows/text-generation/index.js',
      factory: 'createTextGenerationView',
    },
    {
      id: 'chat',
      route: 'chat',
      name: 'Chat',
      icon: 'messages-square',
      persistent: true,
      module: 'src/workflows/chat/index.js',
      factory: 'createChatView',
    },
  ],
};
