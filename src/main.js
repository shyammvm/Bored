import './style.css';
import { uiManager } from './modules/uiManager.js';

// Initialize Bored! App when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  uiManager.init();
  console.log('[Bored!] Coworking Apathy Unit initialized');
});
