// popup.js
(function() {
  'use strict';
  
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

