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
  
  function getCurrentTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0]);
      });
    });
  }
  
  // Toggle Navigation button
  document.getElementById('toggle-btn').addEventListener('click', async () => {
    try {
      const tab = await getCurrentTab();
      chrome.tabs.sendMessage(tab.id, { action: 'toggleNavigation' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message);
        } else if (response && response.success) {
          showStatus(response.navigationActive ? 'Navigation activated' : 'Navigation deactivated');
        } else {
          showStatus('Toggle initiated');
        }
      });
    } catch (error) {
      showStatus('Error: ' + error.message);
    }
  });
  
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
})();

