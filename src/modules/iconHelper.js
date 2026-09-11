import { createIcons, icons } from 'lucide';

/**
 * Replace all <i data-lucide="..."> or <span data-lucide="..."> elements with Lucide SVGs.
 */
export function renderIcons(root = document) {
  try {
    createIcons({
      icons,
      nameAttr: 'data-lucide',
      attrs: {
        'stroke-width': 2,
        class: 'lucide-icon'
      },
      root: root === document ? document.body : root
    });
  } catch (err) {
    console.warn('renderIcons error:', err);
  }
}
