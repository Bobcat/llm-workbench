// Video Pool console: model administration, text-to-video, and image-to-video.
export default {
  id: 'video-pool',
  label: 'Video Pool',
  views: [
    {
      id: 'video-pool-models',
      route: 'video-pool-models',
      name: 'Models',
      tooltip: 'Video pool models',
      icon: 'pool-video',
      persistent: true,
      module: 'src/workflows/video-pool/index.js',
      factory: 'createVideoPoolView',
    },
    {
      id: 'video-generation',
      route: 'video-generation',
      name: 'Video generation',
      icon: 'video-plus',
      persistent: true,
      module: 'src/workflows/video-generation/index.js',
      factory: 'createVideoGenerationView',
    },
  ],
};
