// Image Pool console: model administration, generation, LoRA library, and training.
export default {
  id: 'image-pool',
  label: 'Image Pool',
  views: [
    {
      id: 'image-pool-models',
      route: 'image-pool-models',
      name: 'Models',
      tooltip: 'Image pool models',
      icon: 'pool-image',
      persistent: true,
      module: 'src/workflows/image-pool/index.js',
      factory: 'createImagePoolView',
    },
    {
      id: 'image-generation',
      route: 'image-generation',
      name: 'Image generation',
      icon: 'image-plus',
      persistent: true,
      module: 'src/workflows/image-generation/index.js',
      factory: 'createImageGenerationView',
    },
    {
      id: 'image-lora-library',
      route: 'image-lora-library',
      name: 'LoRA Library',
      icon: 'layers-3',
      persistent: true,
      module: 'src/workflows/lora-library/index.js',
      factory: 'createLoraLibraryView',
    },
    {
      id: 'image-train',
      route: 'image-train',
      name: 'Tuning',
      icon: 'sliders-horizontal',
      persistent: true,
      module: 'src/workflows/image-train/index.js',
      factory: 'createImageTrainView',
    },
  ],
};
