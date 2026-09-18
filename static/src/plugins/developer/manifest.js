// Developer helper. Auxiliary plugins render as one standalone sidebar item at the bottom,
// outside the service categories.
export default {
  id: 'developer',
  label: '',
  auxiliary: true,
  views: [
    {
      id: 'icons',
      route: 'icons',
      name: 'Icons',
      icon: 'shapes',
      persistent: false,
      module: 'src/workflows/icons/index.js',
      factory: 'createIconsView',
    },
  ],
};
