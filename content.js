// SmartTab - Content Script
// (c) Cesar Guirao 2025
(function() {
  'use strict';

  let detectedButtons = [];
  let currentIndex = -1;
  let popupElement = null;
  let detectionTimeout = null;
  let isDetecting = false;
  let autoCloseTimeout = null;
  let statsPopupElement = null;
  let statsOutsideClickHandler = null;
  let statsAnchorElement = null;
  const DETECTION_DEBOUNCE_MS = 500; // Wait 500ms after last mutation before re-detecting
  const AUTO_CLOSE_MS = null; // Disable auto-close timer (was 5000ms)
  const POPUP_OPACITY = 0.93; // Popup opacity
  const LASSO_DURATION_MS = 5000; // Duration to show lasso effect in milliseconds
  const LASSO_BORDER_WIDTH = 4; // Width of the lasso border in pixels
  const LASSO_GLOW_WIDTH = 6; // Width of the lasso glow effect in pixels
  const PIXELS_PER_ACCEPTED = 600; // Estimated distance saved per accepted suggestion (px)
  function formatDateTime(date) {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  function computeStatsSummary() {
    const startDate = new Date(logData.startTime);
    const now = new Date();
    const hoursElapsed = Math.max((now - startDate) / 3600000, 0);
    const untraveledPixels = logData.suggestionsAccepted * PIXELS_PER_ACCEPTED;
    
    return {
      startDateLabel: isNaN(startDate.getTime()) ? 'n/a' : formatDateTime(startDate),
      currentDateLabel: formatDateTime(now),
      hoursElapsedLabel: hoursElapsed.toFixed(1),
      tabPresses: logData.tabPresses,
      acceptedSuggestions: logData.suggestionsAccepted,
      untraveledPixelsK: (untraveledPixels / 1000).toFixed(1)
    };
  }
  
  function hideStatsPopup() {
    if (statsOutsideClickHandler) {
      document.removeEventListener('click', statsOutsideClickHandler, true);
      statsOutsideClickHandler = null;
    }
    if (statsPopupElement) {
      statsPopupElement.remove();
      statsPopupElement = null;
    }
    statsAnchorElement = null;
  }
  
  function showStatsPopup(anchorElement) {
    const stats = computeStatsSummary();
    
    if (!statsPopupElement) {
      statsPopupElement = document.createElement('div');
      statsPopupElement.id = 'smarttab-stats-popup';
      document.body.appendChild(statsPopupElement);
    }
    
    statsPopupElement.innerHTML = `
      <div class="smarttab-stats-header">Session stats</div>
      <div class="smarttab-stats-row"><span>Started</span><span>${stats.startDateLabel}</span></div>
      <div class="smarttab-stats-row"><span>Now</span><span>${stats.currentDateLabel}</span></div>
      <div class="smarttab-stats-row"><span>Hours</span><span>${stats.hoursElapsedLabel} h</span></div>
      <div class="smarttab-stats-row"><span>Tab presses</span><span>${stats.tabPresses.toLocaleString()}</span></div>
      <div class="smarttab-stats-row"><span>Accepted</span><span>${stats.acceptedSuggestions.toLocaleString()}</span></div>
      <div class="smarttab-stats-row"><span>Untraveled</span><span>${stats.untraveledPixelsK}k px</span></div>
    `;
    
    const anchorRect = anchorElement.getBoundingClientRect();
    const popupWidth = 240;
    statsPopupElement.style.position = 'absolute';
    statsPopupElement.style.top = `${window.scrollY + anchorRect.bottom + 8}px`;
    statsPopupElement.style.left = `${window.scrollX + anchorRect.right - popupWidth}px`;
    statsPopupElement.style.width = `${popupWidth}px`;
    statsPopupElement.style.display = 'block';
    
    statsAnchorElement = anchorElement;
    
    if (!statsOutsideClickHandler) {
      statsOutsideClickHandler = (event) => {
        if (!statsPopupElement) return;
        if (statsPopupElement.contains(event.target)) return;
        if (statsAnchorElement && statsAnchorElement.contains(event.target)) return;
        hideStatsPopup();
      };
      document.addEventListener('click', statsOutsideClickHandler, true);
    }
  }
  
  function toggleStatsPopup(anchorElement) {
    if (statsPopupElement && statsPopupElement.style.display === 'block') {
      hideStatsPopup();
    } else {
      showStatsPopup(anchorElement);
    }
  }
  

  // Micro logging
  let logData = {
    tabPresses: 0,
    suggestionsAccepted: 0,
    acceptedSuggestions: [],
    startTime: new Date().toISOString()
  };

  // Detect prominent buttons on the page
  function detectProminentButtons() {
    if (isDetecting) {
      return detectedButtons; // Return cached if already detecting
    }
    
    isDetecting = true;
    const buttons = [];
    const seenElements = new Set(); // Track elements we've already processed
    
    try {
      // Find all actual button elements (limit to first 100 for performance)
      const buttonElements = Array.from(document.querySelectorAll('button')).slice(0, 100);
      for (const btn of buttonElements) {
        if (seenElements.has(btn)) continue;
        if (isVisible(btn) && isProminent(btn)) {
          seenElements.add(btn);
          buttons.push({
            element: btn,
            text: getButtonText(btn),
            selector: generateSelector(btn)
          });
        }
      }

      // Find divs and other elements with role="button" (limit to first 200 for performance)
      const roleButtons = Array.from(document.querySelectorAll('[role="button"]')).slice(0, 200);
      for (const btn of roleButtons) {
        if (seenElements.has(btn)) continue;
        if (btn.tagName !== 'BUTTON' && isVisible(btn) && isProminent(btn)) {
          seenElements.add(btn);
          buttons.push({
            element: btn,
            text: getButtonText(btn),
            selector: generateSelector(btn)
          });
        }
      }

      // Only check a limited set of clickable elements (Gmail and common patterns)
      // Limit this query significantly to avoid performance issues
      const clickableSelectors = [
        'a[role="button"]',
        '[class*="T-I"]', // Gmail button class
        '[class*="button"]', // Button class (case-sensitive, but covers most cases)
        '[class*="Button"]', // Capital B variant
        '[id*="button"]', // Button id
        '[id*="Button"]' // Capital B variant
      ];
      
      for (const selector of clickableSelectors) {
        const elements = Array.from(document.querySelectorAll(selector)).slice(0, 50);
        for (const el of elements) {
          if (seenElements.has(el)) continue;
          if (isVisible(el) && isProminent(el)) {
            // Quick check if it's button-like without expensive operations
            if (isButtonLikeQuick(el)) {
              seenElements.add(el);
              buttons.push({
                element: el,
                text: getButtonText(el),
                selector: generateSelector(el)
              });
            }
          }
        }
      }

      // Calculate scores and sort (only for collected buttons, not all elements)
      const buttonsWithScores = buttons.map(btn => ({
        ...btn,
        score: calculateProminenceScore(btn.element)
      }));

      // Sort by prominence score
      buttonsWithScores.sort((a, b) => b.score - a.score);

      // Get top 5 real buttons
      const topButtons = buttonsWithScores.slice(0, 5).map(({ score, ...btn }) => btn);
      
      // Add fake options
      const fakeOptions = [

        {
          element: null, // No real element
          text: 'Want the AI-up version? join wait list here',
          selector: 'fake-upgrade',
          isFake: true,
          fakeAction: 'upgrade'
        }
      ];
      
      // Return top 5 real buttons + 2 fake options
      return [...topButtons, ...fakeOptions];
    } finally {
      isDetecting = false;
    }
  }

  // Check if element is visible (optimized version)
  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    
    // Quick size check first (cheaper than getComputedStyle)
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    
    // Quick viewport check
    if (rect.bottom < 0 || rect.top > window.innerHeight || 
        rect.right < 0 || rect.left > window.innerWidth) {
      return false;
    }
    
    // Only check computed style if element passes basic checks
    const style = window.getComputedStyle(element);
    
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0
    );
  }

  // Check if element is prominent (has reasonable size and is in viewport)
  function isProminent(element) {
    const rect = element.getBoundingClientRect();
    const minSize = 20; // Minimum 20px in either dimension
    
    return rect.width >= minSize && rect.height >= minSize;
  }

  // Safely get className as string (handles both string and DOMTokenList)
  function getClassNameString(element) {
    if (!element || !element.className) return '';
    // className can be a string or DOMTokenList
    if (typeof element.className === 'string') {
      return element.className;
    }
    // If it's a DOMTokenList, convert to string
    return element.className.toString() || '';
  }

  // Quick check if element is button-like (without expensive operations)
  function isButtonLikeQuick(element) {
    const className = getClassNameString(element).toLowerCase();
    const id = (element.id || '').toLowerCase();
    const role = element.getAttribute('role');
    
    // Quick checks first (no DOM queries)
    if (role === 'button') {
      return true;
    }
    
    // Check if class/id suggests it's a button
    if (className.includes('button') || id.includes('button') || 
        className.includes('btn') || id.includes('btn') ||
        className.includes('t-i')) { // Gmail button class
      return true;
    }
    
    // Check text content (cheap operation)
    const text = (element.textContent || '').toLowerCase().trim();
    const buttonTexts = ['send', 'submit', 'save', 'cancel', 'delete', 'edit', 'add', 'create', 'update', 'confirm', 'ok', 'close', 'next', 'previous', 'back', 'forward'];
    if (buttonTexts.some(bt => text.includes(bt))) {
      return true;
    }
    
    return false;
  }
  
  // Full check if element is button-like (with styling check)
  function isButtonLike(element) {
    if (isButtonLikeQuick(element)) {
      return true;
    }
    
    // Only do expensive check if quick check passes
    const style = window.getComputedStyle(element);
    const cursor = style.cursor;
    return cursor === 'pointer' || cursor === 'hand';
  }

  // Get button text
  function getButtonText(element) {
    // Try aria-label first
    if (element.getAttribute('aria-label')) {
      return element.getAttribute('aria-label');
    }
    
    // Try data-tooltip
    if (element.getAttribute('data-tooltip')) {
      return element.getAttribute('data-tooltip');
    }
    
    // Try title
    if (element.title) {
      return element.title;
    }
    
    // Try text content
    const text = element.textContent?.trim();
    if (text && text.length > 0 && text.length < 100) {
      return text;
    }
    
    // Fallback to tag name or role
    return element.tagName.toLowerCase() || 'Button';
  }

  // Calculate prominence score (optimized)
  function calculateProminenceScore(element) {
    const rect = element.getBoundingClientRect();
    
    let score = 0;
    
    // Size score (larger = more prominent)
    score += (rect.width * rect.height) / 100;
    
    // Position score (higher on page = more prominent, but not too high)
    const viewportHeight = window.innerHeight;
    const distanceFromTop = rect.top;
    
    // Prefer elements in upper-middle area
    if (distanceFromTop > 50 && distanceFromTop < viewportHeight * 0.7) {
      score += 50;
    }
    
    // Only get computed style if needed (expensive operation)
    const className = getClassNameString(element).toLowerCase();
    const id = (element.id || '').toLowerCase();
    const role = element.getAttribute('role');
    
    // Check for accented/primary buttons (high priority boost)
    // Gmail uses "T-I-atl" for accented buttons (primary actions like Send)
    const isAccented = className.includes('t-i-atl') || 
                       className.includes('accent') || 
                       className.includes('primary') ||
                       className.includes('highlight');
    
    if (isAccented) {
      score += 150; // Significant boost for accented buttons
    }
    
    // Check for common button classes/ids (Gmail specific)
    if (className.includes('t-i') || className.includes('button') || id.includes('button') || 
        (role === 'button' && element.tagName !== 'BUTTON')) {
      score += 30;
    }
    
    // Boost score for elements with tabindex (they're meant to be focusable)
    const tabindex = element.getAttribute('tabindex');
    if (tabindex) {
      const tabindexValue = parseInt(tabindex);
      if (tabindexValue >= 0) {
        // tabindex="1" or similar positive values indicate primary actions
        if (tabindexValue === 1) {
          score += 50; // Extra boost for tabindex="1" (primary action)
        } else {
          score += 20; // Standard boost for other positive tabindex values
        }
      }
    }
    
    // Only check z-index and opacity if element might be important
    if (score > 50) {
      const style = window.getComputedStyle(element);
      const zIndex = parseInt(style.zIndex) || 0;
      if (zIndex > 0) {
        score += zIndex / 10;
      }
      const opacity = parseFloat(style.opacity) || 1;
      score *= opacity;
    }
    
    return score;
  }

  // Generate a simple selector for the element
  function generateSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }
    const className = getClassNameString(element);
    if (className) {
      const classes = className.split(' ').filter(c => c.length > 0).slice(0, 2).join('.');
      if (classes) {
        return `${element.tagName.toLowerCase()}.${classes}`;
      }
    }
    return element.tagName.toLowerCase();
  }

  // Create emerald lasso effect around a button
  let currentLassoElement = null;
  let currentLassoTarget = null;
  let lassoUpdateHandler = null;
  
  function updateLassoPosition() {
    if (!currentLassoElement || !currentLassoTarget) return;
    
    const rect = currentLassoTarget.getBoundingClientRect();
    const padding = 4;
    
    const rectX = rect.left - padding;
    const rectY = rect.top - padding;
    const rectWidth = rect.width + padding * 2;
    const rectHeight = rect.height + padding * 2;
    
    // Update both rectangles
    const lassoRect = currentLassoElement.querySelector('rect[stroke="url(#emerald-stripes)"]');
    const glowRect = currentLassoElement.querySelector('rect[filter="url(#blur-filter)"]');
    
    if (lassoRect) {
      lassoRect.setAttribute('x', rectX);
      lassoRect.setAttribute('y', rectY);
      lassoRect.setAttribute('width', rectWidth);
      lassoRect.setAttribute('height', rectHeight);
    }
    
    if (glowRect) {
      glowRect.setAttribute('x', rectX);
      glowRect.setAttribute('y', rectY);
      glowRect.setAttribute('width', rectWidth);
      glowRect.setAttribute('height', rectHeight);
    }
  }
  
  function createLassoEffect(element) {
    // Remove any existing lasso
    removeLassoEffect();
    
    currentLassoTarget = element;
    const rect = element.getBoundingClientRect();
    const padding = 4;
    
    const rectX = rect.left - padding;
    const rectY = rect.top - padding;
    const rectWidth = rect.width + padding * 2;
    const rectHeight = rect.height + padding * 2;
    
    // Create SVG overlay
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'smarttab-lasso';
    svg.style.position = 'fixed';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '999998';
    
    // Create defs for patterns and gradients
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    // Animated stripes pattern
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.setAttribute('id', 'emerald-stripes');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '20');
    pattern.setAttribute('height', '3');
    
    const rect1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect1.setAttribute('width', '10');
    rect1.setAttribute('height', '3');
    rect1.setAttribute('fill', '#34d399'); // Brighter emerald
    
    const rect2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect2.setAttribute('x', '10');
    rect2.setAttribute('width', '10');
    rect2.setAttribute('height', '3');
    rect2.setAttribute('fill', '#047857'); // Darker emerald for higher contrast
    
    const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
    animate.setAttribute('attributeName', 'patternTransform');
    animate.setAttribute('type', 'translate');
    animate.setAttribute('from', '0 0');
    animate.setAttribute('to', '20 0');
    animate.setAttribute('dur', '0.5s');
    animate.setAttribute('repeatCount', 'indefinite');
    
    pattern.appendChild(rect1);
    pattern.appendChild(rect2);
    pattern.appendChild(animate);
    defs.appendChild(pattern);
    
    // Create filter for blur
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'blur-filter');
    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', '4');
    filter.appendChild(feGaussianBlur);
    defs.appendChild(filter);
    
    svg.appendChild(defs);
    
    // Create glow effect (blurred rectangle behind)
    const glowRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    glowRect.setAttribute('x', rectX);
    glowRect.setAttribute('y', rectY);
    glowRect.setAttribute('width', rectWidth);
    glowRect.setAttribute('height', rectHeight);
    glowRect.setAttribute('rx', '6');
    glowRect.setAttribute('ry', '6');
    glowRect.setAttribute('stroke', '#34d399'); // Brighter emerald for glow
    glowRect.setAttribute('stroke-width', LASSO_GLOW_WIDTH);
    glowRect.setAttribute('fill', 'none');
    glowRect.setAttribute('opacity', '0.6'); // Increased opacity for better visibility
    glowRect.setAttribute('filter', 'url(#blur-filter)');
    
    // Create rounded rectangle with emerald lasso effect
    const lassoRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    lassoRect.setAttribute('x', rectX);
    lassoRect.setAttribute('y', rectY);
    lassoRect.setAttribute('width', rectWidth);
    lassoRect.setAttribute('height', rectHeight);
    lassoRect.setAttribute('rx', '6');
    lassoRect.setAttribute('ry', '6');
    lassoRect.setAttribute('stroke', 'url(#emerald-stripes)');
    lassoRect.setAttribute('stroke-width', LASSO_BORDER_WIDTH);
    lassoRect.setAttribute('fill', 'none');
    lassoRect.style.opacity = '1';
    lassoRect.style.transition = 'opacity 0.2s';
    
    svg.appendChild(glowRect);
    svg.appendChild(lassoRect);
    
    document.body.appendChild(svg);
    currentLassoElement = svg;
    
    // Add scroll and resize handlers to update lasso position
    lassoUpdateHandler = () => updateLassoPosition();
    window.addEventListener('scroll', lassoUpdateHandler, true);
    window.addEventListener('resize', lassoUpdateHandler);
  }
  
  function removeLassoEffect() {
    if (lassoUpdateHandler) {
      window.removeEventListener('scroll', lassoUpdateHandler, true);
      window.removeEventListener('resize', lassoUpdateHandler);
      lassoUpdateHandler = null;
    }
    if (currentLassoElement) {
      currentLassoElement.remove();
      currentLassoElement = null;
    }
    currentLassoTarget = null;
  }

  // Handle fake button actions
  function handleFakeButtonAction(button) {
    if (!button.isFake) return false;
    
    if (button.fakeAction === 'close') {
      closeSmartNavigation();
      return true;
    } else if (button.fakeAction === 'upgrade') {
      window.open('https://forms.gle/kuzxpQ5DNdd6PbTVA', '_blank');
      closeSmartNavigation();
      return true;
    }
    return false;
  }

  // Focus a specific button by index
  function focusButtonByIndex(index) {
    if (index < 0 || index >= detectedButtons.length) {
      return false;
    }

    currentIndex = index;
    const button = detectedButtons[index];
    
    // Handle fake buttons
    if (button.isFake) {
      updatePopup();
      showPopup();
      resetAutoCloseTimer();
      return true;
    }
    
    try {
      // Try to focus the element
      if (button.element.focus) {
        button.element.focus();
      } else {
        // For elements without focus, simulate click or set tabindex
        if (!button.element.hasAttribute('tabindex')) {
          button.element.setAttribute('tabindex', '0');
        }
        button.element.focus();
      }
      
      // Scroll into view
      button.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Add emerald lasso effect
      createLassoEffect(button.element);
      
      // Lasso stays on until next selection or window close
      
      // Refresh button list after focusing
      setTimeout(() => {
        detectedButtons = detectProminentButtons();
        if (currentIndex >= detectedButtons.length) {
          currentIndex = -1;
        }
        updatePopup();
        showPopup(); // Ensure popup stays visible after refresh
      }, 300);
      
      return true;
    } catch (e) {
      console.error('Error focusing button:', e);
      return false;
    }
  }

  // Add click handlers to popup items
  function attachPopupItemHandlers() {
    if (!popupElement) return;
    
    const items = popupElement.querySelectorAll('.smarttab-item');
    items.forEach(item => {
      // Use event delegation or add handler directly
      // Since we're replacing innerHTML, we need to add handlers fresh each time
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(item.getAttribute('data-index'));
        if (!isNaN(index) && index >= 0 && index < detectedButtons.length) {
          const button = detectedButtons[index];
          // Handle fake buttons directly on click
          if (button.isFake) {
            handleFakeButtonAction(button);
          } else {
            focusButtonByIndex(index);
          }
          resetAutoCloseTimer(); // Reset timer on user interaction
        }
      });
    });
  }

  // Create popup UI
  function createPopup() {
    if (popupElement) {
      popupElement.remove();
    }

    popupElement = document.createElement('div');
    popupElement.id = 'smarttab-popup';
    popupElement.style.opacity = POPUP_OPACITY;
    popupElement.innerHTML = `
      <div class="smarttab-header">
        <div class="smarttab-title-section">
          <span class="smarttab-title">TabTab Go</span>
          <span class="smarttab-copyright">by cesar guirao & jose berengueres</span>
        </div>
        <div class="smarttab-header-actions">
          <button class="smarttab-stats" id="smarttab-stats-btn" title="Session stats">📊</button>
          <button class="smarttab-download" id="smarttab-download-btn" title="Download logs">⬇</button>
          <button class="smarttab-close" id="smarttab-close-btn" title="Close">×</button>
        </div>
      </div>
      <div class="smarttab-list" id="smarttab-list">
        ${detectedButtons.map((btn, index) => `
          <div class="smarttab-item ${index === currentIndex ? 'active' : ''}" data-index="${index}">
            <span class="smarttab-number">${index + 1}</span>
            <span class="smarttab-text">${escapeHtml(btn.text)}</span>
          </div>
        `).join('')}
      </div>
    `;

    document.body.appendChild(popupElement);

    // Close button handler
    const closeBtn = popupElement.querySelector('#smarttab-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        hidePopup();
      });
    }
    
    const statsBtn = popupElement.querySelector('#smarttab-stats-btn');
    if (statsBtn) {
      statsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleStatsPopup(statsBtn);
      });
    }
    
    // Download button handler
    const downloadBtn = popupElement.querySelector('#smarttab-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        exportLogToFile();
      });
    }
    
    // Attach click handlers to popup items
    attachPopupItemHandlers();
  }

  // Update popup
  function updatePopup() {
    if (!popupElement) return;
    
    const list = popupElement.querySelector('#smarttab-list');
    if (list) {
      list.innerHTML = detectedButtons.map((btn, index) => `
        <div class="smarttab-item ${index === currentIndex ? 'active' : ''}" data-index="${index}">
          <span class="smarttab-number">${index + 1}</span>
          <span class="smarttab-text">${escapeHtml(btn.text)}</span>
        </div>
      `).join('');
      
      // Re-attach click handlers after updating HTML
      attachPopupItemHandlers();
    }
  }

  // Reset auto-close timer
  function resetAutoCloseTimer() {
    // Clear existing timeout
    if (autoCloseTimeout) {
      clearTimeout(autoCloseTimeout);
      autoCloseTimeout = null;
    }
    
    // Skip auto-close when disabled
    if (!AUTO_CLOSE_MS) {
      return;
    }
    
    // Set new timeout to close after inactivity
    autoCloseTimeout = setTimeout(() => {
      closeSmartNavigation();
    }, AUTO_CLOSE_MS);
  }

  // Show popup
  function showPopup() {
    if (popupElement) {
      popupElement.style.display = 'block';
    } else {
      createPopup();
    }
    // Reset auto-close timer when popup is shown
    resetAutoCloseTimer();
  }

  // Hide popup and reset navigation state
  function hidePopup() {
    if (popupElement) {
      popupElement.style.display = 'none';
    }
    hideStatsPopup();
    // Reset current index so next Tab press triggers fresh detection
    currentIndex = -1;
  }
  
  // Save log silently to Chrome storage
  function saveLogToStorage() {
    const logContent = {
      session: {
        startTime: logData.startTime,
        endTime: new Date().toISOString(),
        totalTabPresses: logData.tabPresses,
        totalSuggestionsAccepted: logData.suggestionsAccepted
      },
      acceptedSuggestions: logData.acceptedSuggestions
    };
    
    // Save to Chrome storage silently
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        smarttabLog: logContent,
        smarttabLogTimestamp: new Date().toISOString()
      });
    } else {
      // Fallback to localStorage if Chrome API not available
      try {
        localStorage.setItem('smarttabLog', JSON.stringify(logContent));
        localStorage.setItem('smarttabLogTimestamp', new Date().toISOString());
      } catch (e) {
        console.warn('Could not save log:', e);
      }
    }
  }

  // Export log to file (can be called manually or automatically)
  function exportLogToFile() {
    const logContent = {
      session: {
        startTime: logData.startTime,
        endTime: new Date().toISOString(),
        totalTabPresses: logData.tabPresses,
        totalSuggestionsAccepted: logData.suggestionsAccepted
      },
      acceptedSuggestions: logData.acceptedSuggestions
    };
    
    const logText = JSON.stringify(logContent, null, 2);
    const blob = new Blob([logText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smarttab-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Close smart navigation (hide popup and reset state)
  function closeSmartNavigation() {
    // Clear auto-close timer
    if (autoCloseTimeout) {
      clearTimeout(autoCloseTimeout);
      autoCloseTimeout = null;
    }
    hidePopup();
    removeLassoEffect(); // Remove lasso when closing navigation
    hideStatsPopup();
    // Clear detected buttons so they're re-detected on next Tab press
    detectedButtons = [];
    currentIndex = -1;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Focus next button
  function focusNextButton(backward = false) {
    if (detectedButtons.length === 0) {
      detectedButtons = detectProminentButtons();
      if (detectedButtons.length === 0) {
        return false;
      }
    }

    if (backward) {
      currentIndex = currentIndex <= 0 ? detectedButtons.length - 1 : currentIndex - 1;
    } else {
      currentIndex = (currentIndex + 1) % detectedButtons.length;
    }
    const button = detectedButtons[currentIndex];
    
    // Handle fake buttons
    if (button.isFake) {
      updatePopup();
      showPopup();
      resetAutoCloseTimer();
      return true;
    }
    
    try {
      // Try to focus the element
      if (button.element.focus) {
        button.element.focus();
      } else {
        // For elements without focus, simulate click or set tabindex
        if (!button.element.hasAttribute('tabindex')) {
          button.element.setAttribute('tabindex', '0');
        }
        button.element.focus();
      }
      
      // Scroll into view
      button.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Add emerald lasso effect
      createLassoEffect(button.element);
      
      // Lasso stays on until next selection or window close
      
      updatePopup();
      showPopup();
      resetAutoCloseTimer(); // Reset timer on user interaction
      
      return true;
    } catch (e) {
      console.error('Error focusing button:', e);
      return false;
    }
  }

  // Intercept Tab key
  function interceptTab(event) {
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Only intercept if we're not in an input field
      const activeElement = document.activeElement;
      const isInputField = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
      );

      if (!isInputField) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation(); // Stop other handlers from running
        
        // If popup was closed, reset state for fresh detection
        if (detectedButtons.length === 0 || currentIndex === -1) {
          detectedButtons = [];
          currentIndex = -1;
        }
        
        const backward = event.shiftKey;
        if (focusNextButton(backward)) {
          // Log tab press
          logData.tabPresses++;
          resetAutoCloseTimer(); // Reset timer on Tab key interaction
          return false;
        }
      }
    }
    return true;
  }
  
  // Intercept Enter and Space keys to close smart navigation when button is activated
  function interceptActivationKeys(event) {
    const isEnter = event.key === 'Enter';
    const isSpace = event.key === ' ' || event.code === 'Space' || event.key === 'Spacebar';
    
    if ((isEnter || isSpace) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Check if we have a current index selected
      if (currentIndex >= 0 && currentIndex < detectedButtons.length) {
        const button = detectedButtons[currentIndex];
        
        // Handle fake buttons
        if (button.isFake) {
          event.preventDefault();
          event.stopPropagation();
          handleFakeButtonAction(button);
          return false;
        }
        
        // Check if the currently focused element is one of our detected buttons
        const activeElement = document.activeElement;
        if (activeElement && button.element === activeElement) {
          // Log accepted suggestion
          logData.suggestionsAccepted++;
          logData.acceptedSuggestions.push({
            timestamp: new Date().toISOString(),
            suggestionName: button.text || 'Unknown',
            url: window.location.href
          });
          
          // Save log silently to storage periodically (every 5 accepted suggestions)
          if (logData.suggestionsAccepted % 5 === 0) {
            saveLogToStorage();
          }
          
          // Close smart navigation when Enter is pressed on a detected button
          closeSmartNavigation();
          // Let the Enter event proceed normally to activate the button
          return true;
        }
      }
    }
    return true;
  }

  // Intercept ESC key to close smart navigation
  function interceptEscape(event) {
    if (event.key === 'Escape' && popupElement && popupElement.style.display !== 'none') {
      event.preventDefault();
      event.stopPropagation();
      closeSmartNavigation();
      return false;
    }
    return true;
  }

  // Debounced button detection
  function debouncedDetectButtons() {
    // Clear existing timeout
    if (detectionTimeout) {
      clearTimeout(detectionTimeout);
    }
    
    // Set new timeout
    detectionTimeout = setTimeout(() => {
      detectedButtons = detectProminentButtons();
      if (currentIndex >= detectedButtons.length) {
        currentIndex = -1;
      }
      updatePopup();
    }, DETECTION_DEBOUNCE_MS);
  }

  // Initialize
  function init() {
    // Detect buttons on page load (with a small delay to let page settle)
    setTimeout(() => {
      detectedButtons = detectProminentButtons();
      
      // Show popup initially
      if (detectedButtons.length > 0) {
        showPopup();
        // Auto-close is now handled by resetAutoCloseTimer() in showPopup()
      }
    }, 1000);
    
    // Listen for Tab key - use capture phase and add to window for earliest interception
    // This ensures we intercept before any page scripts
    window.addEventListener('keydown', interceptTab, true);
    document.addEventListener('keydown', interceptTab, true);
    
    // Listen for Enter key to close navigation when button is activated
    window.addEventListener('keydown', interceptActivationKeys, true);
    document.addEventListener('keydown', interceptActivationKeys, true);
    
    // Listen for ESC key to close navigation
    window.addEventListener('keydown', interceptEscape, true);
    document.addEventListener('keydown', interceptEscape, true);
    
    // Re-detect buttons when DOM changes (for dynamic pages like Gmail)
    // Use debouncing to avoid excessive re-detection
    const observer = new MutationObserver((mutations) => {
      // Only re-detect if there are significant changes
      let shouldRedetect = false;
      
      for (const mutation of mutations) {
        // Only care about added nodes or attribute changes to relevant attributes
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if any added node might be a button
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) { // Element node
              const tagName = node.tagName?.toLowerCase();
              const role = node.getAttribute?.('role');
              const className = getClassNameString(node);
              
              if (tagName === 'button' || 
                  role === 'button' || 
                  className.includes('button') || 
                  className.includes('t-i')) {
                shouldRedetect = true;
                break;
              }
            }
          }
        } else if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          if (attrName === 'role' || attrName === 'class' || attrName === 'style') {
            shouldRedetect = true;
          }
        }
        
        if (shouldRedetect) break;
      }
      
      if (shouldRedetect) {
        debouncedDetectButtons();
      }
    });
    
    // Observe with more limited scope
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'role']
    });
    
    // Save log silently to storage when page is about to unload
    window.addEventListener('beforeunload', () => {
      if (logData.suggestionsAccepted > 0) {
        saveLogToStorage();
      }
    });
    
    // Also save periodically (every 30 seconds) to ensure data is persisted
    setInterval(() => {
      if (logData.tabPresses > 0 || logData.suggestionsAccepted > 0) {
        saveLogToStorage();
      }
    }, 30000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

