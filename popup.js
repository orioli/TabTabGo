// popup.js
(function() {
  'use strict';
  
  // Get version from manifest.json (single source of truth)
  const VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) 
    ? chrome.runtime.getManifest().version 
    : '1.0.6'; // Fallback if manifest not available
  
  const CITATION_TEXT = `Guirao, C., & Berengueres, J. (2025). TabTab Go (v${VERSION}) [Computer software]. Nazarbayev University. https://github.com/orioli/tabtabgo`;
  
  // Update version and citation text in DOM when page loads
  function updateVersionAndCitation() {
    // Update title with version
    const title = document.querySelector('.title');
    if (title) {
      title.textContent = `TabTab Go ${VERSION}`;
    }
    
    // Update citation text
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) {
      subtitle.textContent = CITATION_TEXT;
    }
    
    // Find the first paragraph in the cite modal (the one with margin-bottom)
    const citeModal = document.getElementById('cite-modal');
    if (citeModal) {
      const citeParagraph = citeModal.querySelector('p[style*="margin-bottom"]');
      if (citeParagraph) {
        citeParagraph.textContent = CITATION_TEXT;
      }
    }
  }
  
  // Update version and citation when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateVersionAndCitation);
  } else {
    updateVersionAndCitation();
  }
  
  function showStatus(message, duration = 2000) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.classList.add('show');
    setTimeout(() => {
      statusEl.classList.remove('show');
    }, duration);
  }
  
  // How to button - show modal
  const howtoBtn = document.getElementById('howto-btn');
  const howtoModal = document.getElementById('howto-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  
  howtoBtn.addEventListener('click', () => {
    howtoModal.classList.add('show');
  });
  
  modalCloseBtn.addEventListener('click', () => {
    howtoModal.classList.remove('show');
  });
  
  // Close modal when clicking outside
  howtoModal.addEventListener('click', (e) => {
    if (e.target === howtoModal) {
      howtoModal.classList.remove('show');
    }
  });
  
  // Cite button - show citation modal
  const citeBtn = document.getElementById('cite-btn');
  const citeModal = document.getElementById('cite-modal');
  const citeModalCloseBtn = document.getElementById('cite-modal-close-btn');
  
  citeBtn.addEventListener('click', () => {
    citeModal.classList.add('show');
  });
  
  citeModalCloseBtn.addEventListener('click', () => {
    citeModal.classList.remove('show');
  });
  
  // Close citation modal when clicking outside
  citeModal.addEventListener('click', (e) => {
    if (e.target === citeModal) {
      citeModal.classList.remove('show');
    }
  });
})();

