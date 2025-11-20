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
  let colorPickerPopupElement = null;
  let colorPickerOutsideClickHandler = null;
  let selectedColor = '#10b981'; // Default emerald green
  // Color palette - up to 20 colors including pink, yellow, lime, teal, emerald green, and pastels
  const COLOR_PALETTE = [
    '#f472b6', // mypink
    '#10b981', // Emerald green (default)
    '#e8b4a5', // Warm pastel salmon
    '#d7a7b8', // Muted warm pink
    '#e4c28d', // Soft muted amber
    '#c9d6a3', // Warm moss green pastel
    '#ec4899', 
    '#fda4af',
    '#fb7185'];
  const DETECTION_DEBOUNCE_MS = 500; // Wait 500ms after last mutation before re-detecting
  const AUTO_CLOSE_MS = null; // Disable auto-close timer (was 5000ms)
  const POPUP_OPACITY = 0.93; // Popup opacity
  const LASSO_DURATION_MS = 5000; // Duration to show lasso effect in milliseconds
  const LASSO_BORDER_WIDTH = 4; // Width of the lasso border in pixels
  const LASSO_GLOW_WIDTH = 6; // Width of the lasso glow effect in pixels
  const PIXELS_PER_ACCEPTED = 600; // Estimated distance saved per accepted suggestion (px)
  const MAX_TOP_BUTTONS = 5; // Maximum number of top buttons to show
  
  // Stats tracking (JavaScript version of statsStore.ts)
  const STATS_STORAGE_KEY = 'tabtabgo_stats';
  let statsCache = null;
  let statsInitialized = false;
  let statsWriteTimer = null;
  const STATS_WRITE_DEBOUNCE_MS = 500;
  
  // Initialize stats store
  async function initStatsStore() {
    if (statsInitialized && statsCache !== null) return;
    
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(STATS_STORAGE_KEY);
        const storedData = result[STATS_STORAGE_KEY];
        
        if (storedData && typeof storedData === 'object') {
          statsCache = storedData;
        } else {
          statsCache = {};
        }
      } else {
        statsCache = {};
      }
      statsInitialized = true;
    } catch (error) {
      console.error('[SmartTab] Error loading stats from storage:', error);
      statsCache = {};
      statsInitialized = true;
    }
  }
  
  // Ensure stats store is initialized (lazy init)
  async function ensureStatsInitialized() {
    if (!statsInitialized || statsCache === null) {
      await initStatsStore();
    }
  }
  
  // Generate page key from current location
  function makePageKey() {
    try {
      const hostname = window.location.hostname || 'unknown';
      const pathname = window.location.pathname || '';
      // Use hostname + first part of pathname (e.g., "gmail.com/inbox" or "gmail.com/compose")
      const pathParts = pathname.split('/').filter(p => p);
      const pageIdentifier = pathParts.length > 0 ? pathParts[0] : 'root';
      return `${hostname}/${pageIdentifier}`;
    } catch (error) {
      return window.location.hostname || 'unknown';
    }
  }
  
  // Get element key from button (use text as key)
  function getElementKeyForButton(button) {
    if (!button) return 'Unknown';
    // Use button text, cleaned up
    const text = button.text || 'Unknown';
    // Remove extra whitespace and limit length
    return text.trim().substring(0, 100) || 'Unknown';
  }
  
  // Schedule debounced write to storage
  function scheduleStatsWrite() {
    if (statsWriteTimer !== null) {
      clearTimeout(statsWriteTimer);
    }
    
    statsWriteTimer = setTimeout(async () => {
      if (statsCache !== null) {
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ [STATS_STORAGE_KEY]: statsCache });
          }
        } catch (error) {
          console.error('[SmartTab] Error saving stats to storage:', error);
        }
      }
      statsWriteTimer = null;
    }, STATS_WRITE_DEBOUNCE_MS);
  }
  
  // Ensure entry exists for [pageKey][elementKey]
  function ensureStatsEntry(pageKey, elementKey) {
    if (statsCache === null) {
      statsCache = {};
    }
    
    if (!statsCache[pageKey]) {
      statsCache[pageKey] = {};
      // Initialize total selections counter for this page
      statsCache[pageKey].__totalSelections__ = 0;
    }
    
    if (!statsCache[pageKey][elementKey]) {
      statsCache[pageKey][elementKey] = {
        shown: 0,
        clicked: 0
      };
    }
  }
  
  // Record total selections (Enter/Spacebar presses) for a page
  async function recordTotalSelection(pageKey) {
    await ensureStatsInitialized();
    
    if (statsCache === null) {
      statsCache = {};
    }
    
    if (!statsCache[pageKey]) {
      statsCache[pageKey] = {};
      statsCache[pageKey].__totalSelections__ = 0;
    }
    
    if (statsCache[pageKey].__totalSelections__ === undefined) {
      statsCache[pageKey].__totalSelections__ = 0;
    }
    
    statsCache[pageKey].__totalSelections__++;
    scheduleStatsWrite();
  }
  
  // Record when a button is shown as a candidate
  async function recordButtonShown(pageKey, elementKey) {
    await ensureStatsInitialized();
    
    ensureStatsEntry(pageKey, elementKey);
    
    if (statsCache && statsCache[pageKey] && statsCache[pageKey][elementKey]) {
      statsCache[pageKey][elementKey].shown++;
      scheduleStatsWrite();
    }
  }
  
  // Record when a button is actually clicked
  async function recordButtonClicked(pageKey, elementKey) {
    await ensureStatsInitialized();
    
    ensureStatsEntry(pageKey, elementKey);
    
    if (statsCache && statsCache[pageKey] && statsCache[pageKey][elementKey]) {
      statsCache[pageKey][elementKey].clicked++;
      scheduleStatsWrite();
    }
  }
  
  // Calculates the click percentage (clicked / (total clicks + total selections of the menu (enter or spacebar)) × 100)
  function getButtonClickPercentage(pageKey, elementKey) {
    // Ensure stats are initialized (synchronous check)
    if (!statsInitialized || !statsCache) {
      return null;
    }
    
    if (!statsCache[pageKey] || !statsCache[pageKey][elementKey]) {
      return null;
    }
    
    const stats = statsCache[pageKey][elementKey];
    const totalSelections = statsCache[pageKey].__totalSelections__ || 0;
    
    // Need at least one selection to calculate percentage
    if (totalSelections === 0) {
      return null;
    }
    
    // Calculate percentage: clicked / totalSelections × 100
    const percentage = (stats.clicked / totalSelections) * 100;
    
    // Format to 2 significant digits
    // Use toPrecision(2) which handles all cases correctly
    const formatted = parseFloat(percentage.toPrecision(2));
    
    // If it's 100 or above, just return 100
    if (formatted >= 100) {
      return 100;
    }
    
    return formatted;
  }
  
  // Get button click count
  function getButtonClickCount(pageKey, elementKey) {
    // Ensure stats are initialized (synchronous check)
    if (!statsInitialized || !statsCache) {
      return null;
    }
    
    if (!statsCache[pageKey] || !statsCache[pageKey][elementKey]) {
      return null;
    }
    
    const stats = statsCache[pageKey][elementKey];
    return stats.clicked || 0;
  }
  
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
  
  // Color picker functions
  function hideColorPickerPopup() {
    if (colorPickerOutsideClickHandler) {
      document.removeEventListener('click', colorPickerOutsideClickHandler, true);
      colorPickerOutsideClickHandler = null;
    }
    if (colorPickerPopupElement) {
      colorPickerPopupElement.remove();
      colorPickerPopupElement = null;
    }
  }
  
  function showColorPickerPopup(anchorElement) {
    if (!colorPickerPopupElement) {
      colorPickerPopupElement = document.createElement('div');
      colorPickerPopupElement.id = 'smarttab-color-picker-popup';
      document.body.appendChild(colorPickerPopupElement);
    }
    
    colorPickerPopupElement.innerHTML = `
      <div class="smarttab-color-picker-grid">
        ${COLOR_PALETTE.map(color => `
          <div class="smarttab-color-option ${color === selectedColor ? 'selected' : ''}" 
               data-color="${color}" 
               style="background-color: ${color};"
               title="${color}">
            ${color === selectedColor ? '✓' : ''}
          </div>
        `).join('')}
      </div>
    `;
    
    const anchorRect = anchorElement.getBoundingClientRect();
    const popupWidth = 200;
    colorPickerPopupElement.style.position = 'absolute';
    colorPickerPopupElement.style.top = `${window.scrollY + anchorRect.bottom + 8}px`;
    colorPickerPopupElement.style.left = `${window.scrollX + anchorRect.right - popupWidth}px`;
    colorPickerPopupElement.style.width = `${popupWidth}px`;
    colorPickerPopupElement.style.display = 'block';
    
    // Add click handlers for color options
    const colorOptions = colorPickerPopupElement.querySelectorAll('.smarttab-color-option');
    colorOptions.forEach(option => {
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        const newColor = option.getAttribute('data-color');
        changeColor(newColor);
        hideColorPickerPopup();
      });
    });
    
    if (!colorPickerOutsideClickHandler) {
      colorPickerOutsideClickHandler = (event) => {
        if (!colorPickerPopupElement) return;
        if (colorPickerPopupElement.contains(event.target)) return;
        if (anchorElement && anchorElement.contains(event.target)) return;
        hideColorPickerPopup();
      };
      document.addEventListener('click', colorPickerOutsideClickHandler, true);
    }
  }
  
  function toggleColorPickerPopup(anchorElement) {
    if (colorPickerPopupElement && colorPickerPopupElement.style.display === 'block') {
      hideColorPickerPopup();
    } else {
      showColorPickerPopup(anchorElement);
    }
  }
  
  function changeColor(color) {
    selectedColor = color;
    
    // Update popup window border and box-shadow
    if (popupElement) {
      const borderColor = hexToRgba(color, 0.4);
      popupElement.style.border = `4px solid ${borderColor}`;
      popupElement.style.boxShadow = `0 8px 24px ${hexToRgba(color, 0.25)}, 0 12px 32px rgba(0, 0, 0, 0.15)`;
      
      // Update popup header background
      const header = popupElement.querySelector('.smarttab-header');
      if (header) {
        header.style.background = color;
      }
      
      // Update active item styles
      const activeItem = popupElement.querySelector('.smarttab-item.active');
      if (activeItem) {
        const lightBgColor = getLightBackgroundColor(color);
        activeItem.style.backgroundColor = lightBgColor;
        activeItem.style.borderLeftColor = color;
        
        // Update active item text color
        const activeText = activeItem.querySelector('.smarttab-text');
        if (activeText) {
          activeText.style.color = color;
        }
        
        // Update active item number badge background
        const activeNumber = activeItem.querySelector('.smarttab-number');
        if (activeNumber) {
          activeNumber.style.background = color;
        }
      }
    }
    
    // Update existing lasso if present
    if (currentLassoElement) {
      updateLassoColor(color);
    }
    
    // Save to storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ smarttabColor: color });
    } else {
      try {
        localStorage.setItem('smarttabColor', color);
      } catch (e) {
        console.warn('Could not save color:', e);
      }
    }
  }
  
  function updateLassoColor(color) {
    if (!currentLassoElement) return;
    
    // Create a darker version for contrast
    const rgb = hexToRgb(color);
    const darkerColor = `rgb(${Math.max(0, rgb.r - 30)}, ${Math.max(0, rgb.g - 30)}, ${Math.max(0, rgb.b - 30)})`;
    const lighterColor = `rgb(${Math.min(255, rgb.r + 50)}, ${Math.min(255, rgb.g + 50)}, ${Math.min(255, rgb.b + 50)})`;
    
    // Update pattern
    const pattern = currentLassoElement.querySelector('pattern[id="emerald-stripes"]');
    if (pattern) {
      const rect1 = pattern.querySelector('rect:nth-child(1)');
      const rect2 = pattern.querySelector('rect:nth-child(2)');
      if (rect1) rect1.setAttribute('fill', lighterColor);
      if (rect2) rect2.setAttribute('fill', darkerColor);
    }
    
    // Update glow
    const glowRect = currentLassoElement.querySelector('rect[filter="url(#blur-filter)"]');
    if (glowRect) {
      glowRect.setAttribute('stroke', lighterColor);
    }
    
    // Update border
    const lassoRect = currentLassoElement.querySelector('rect[stroke="url(#emerald-stripes)"]');
    if (lassoRect) {
      // Pattern is already updated above
    }
  }
  
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 16, g: 185, b: 129 }; // Default emerald
  }
  
  function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
  
  function getLightBackgroundColor(hex) {
    // Create a very light, pastel-like version of the color for active item background
    // Mix with white (around 85-90% white) to create a subtle tint
    const rgb = hexToRgb(hex);
    const mixFactor = 0.87; // Mix with 87% white
    return `rgb(${Math.round(255 - (255 - rgb.r) * (1 - mixFactor))}, ${Math.round(255 - (255 - rgb.g) * (1 - mixFactor))}, ${Math.round(255 - (255 - rgb.b) * (1 - mixFactor))})`;
  }
  
  function loadSavedColor() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['smarttabColor'], (result) => {
        if (result.smarttabColor) {
          changeColor(result.smarttabColor);
        }
      });
    } else {
      try {
        const savedColor = localStorage.getItem('smarttabColor');
        if (savedColor) {
          changeColor(savedColor);
        }
      } catch (e) {
        console.warn('Could not load color:', e);
      }
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

      // Get top real buttons
      const topButtons = buttonsWithScores.slice(0, MAX_TOP_BUTTONS).map(({ score, ...btn }) => btn);
      
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
    
    // Get color values based on selected color
    const rgb = hexToRgb(selectedColor);
    const darkerColor = `rgb(${Math.max(0, rgb.r - 30)}, ${Math.max(0, rgb.g - 30)}, ${Math.max(0, rgb.b - 30)})`;
    const lighterColor = `rgb(${Math.min(255, rgb.r + 50)}, ${Math.min(255, rgb.g + 50)}, ${Math.min(255, rgb.b + 50)})`;
    
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
    rect1.setAttribute('fill', lighterColor);
    
    const rect2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect2.setAttribute('x', '10');
    rect2.setAttribute('width', '10');
    rect2.setAttribute('height', '3');
    rect2.setAttribute('fill', darkerColor);
    
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
    glowRect.setAttribute('stroke', lighterColor);
    glowRect.setAttribute('stroke-width', LASSO_GLOW_WIDTH);
    glowRect.setAttribute('fill', 'none');
    glowRect.setAttribute('opacity', '0.6'); // Increased opacity for better visibility
    glowRect.setAttribute('filter', 'url(#blur-filter)');
    
    // Create rounded rectangle with lasso effect
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
    const borderColor = hexToRgba(selectedColor, 0.4);
    popupElement.style.border = `4px solid ${borderColor}`;
    popupElement.style.boxShadow = `0 8px 24px ${hexToRgba(selectedColor, 0.25)}, 0 12px 32px rgba(0, 0, 0, 0.15)`;
    popupElement.innerHTML = `
      <div class="smarttab-header" style="background: ${selectedColor}">
        <div class="smarttab-title-section">
          <span class="smarttab-title">TabTab Go</span>
          <span class="smarttab-copyright">by cesar guirao & jose berengueres</span>
        </div>
        <div class="smarttab-header-actions">
          <button class="smarttab-color-picker" id="smarttab-color-picker-btn" title="Change color">🎨</button>
          <button class="smarttab-stats" id="smarttab-stats-btn" title="Session stats">📊</button>
          <button class="smarttab-download" id="smarttab-download-btn" title="Download stats & logs">💾</button>
          <button class="smarttab-close" id="smarttab-close-btn" title="Close">×</button>
        </div>
      </div>
      <div class="smarttab-list" id="smarttab-list">
        ${detectedButtons.map((btn, index) => {
          const isActive = index === currentIndex;
          const activeBgColor = isActive ? getLightBackgroundColor(selectedColor) : '';
          const activeStyle = isActive ? `style="background-color: ${activeBgColor}; border-left-color: ${selectedColor};"` : '';
          
          // Get click percentage and count for this button
          let statsText = '';
          if (!btn.isFake) {
            const pageKey = makePageKey();
            const elementKey = getElementKeyForButton(btn);
            const percentage = getButtonClickPercentage(pageKey, elementKey);
            const count = getButtonClickCount(pageKey, elementKey);
            
            if (percentage !== null && count !== null && count > 0) {
              statsText = ` (${percentage}%) ${count}`;
            } else if (count !== null && count > 0) {
              statsText = ` ${count}`;
            }
          }
          
          return `
          <div class="smarttab-item ${isActive ? 'active' : ''}" 
               data-index="${index}"
               ${activeStyle}>
            <span class="smarttab-number" ${isActive ? `style="background: ${selectedColor};"` : ''}>${index + 1}</span>
            <span class="smarttab-text" ${isActive ? `style="color: ${selectedColor};"` : ''}>${escapeHtml(btn.text)}${statsText}</span>
          </div>
        `;
        }).join('')}
      </div>
    `;

    document.body.appendChild(popupElement);

    // Record all shown buttons
    const pageKey = makePageKey();
    detectedButtons.forEach(button => {
      if (!button.isFake) {
        const elementKey = getElementKeyForButton(button);
        recordButtonShown(pageKey, elementKey);
      }
    });

    // Close button handler
    const closeBtn = popupElement.querySelector('#smarttab-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        hidePopup();
      });
    }
    
    const colorPickerBtn = popupElement.querySelector('#smarttab-color-picker-btn');
    if (colorPickerBtn) {
      colorPickerBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleColorPickerPopup(colorPickerBtn);
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
      list.innerHTML = detectedButtons.map((btn, index) => {
        const isActive = index === currentIndex;
        const activeBgColor = isActive ? getLightBackgroundColor(selectedColor) : '';
        const activeStyle = isActive ? `style="background-color: ${activeBgColor}; border-left-color: ${selectedColor};"` : '';
        
        // Get click percentage and count for this button
        let statsText = '';
        if (!btn.isFake) {
          const pageKey = makePageKey();
          const elementKey = getElementKeyForButton(btn);
          const percentage = getButtonClickPercentage(pageKey, elementKey);
          const count = getButtonClickCount(pageKey, elementKey);
          
          if (percentage !== null && count !== null && count > 0) {
            statsText = ` (${percentage}%) ${count}`;
          } else if (count !== null && count > 0) {
            statsText = ` ${count}`;
          }
        }
        
        return `
        <div class="smarttab-item ${isActive ? 'active' : ''}" 
             data-index="${index}"
             ${activeStyle}>
          <span class="smarttab-number" ${isActive ? `style="background: ${selectedColor};"` : ''}>${index + 1}</span>
          <span class="smarttab-text" ${isActive ? `style="color: ${selectedColor};"` : ''}>${escapeHtml(btn.text)}${statsText}</span>
        </div>
      `;
      }).join('');
      
      // Record all shown buttons when popup is updated
      const pageKey = makePageKey();
      detectedButtons.forEach(button => {
        if (!button.isFake) {
          const elementKey = getElementKeyForButton(button);
          recordButtonShown(pageKey, elementKey);
        }
      });
      
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
    hideColorPickerPopup();
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

  // Export log and stats to file (can be called manually or automatically)
  async function exportLogToFile() {
    try {
      // Get session log data
      const logContent = {
        session: {
          startTime: logData.startTime,
          endTime: new Date().toISOString(),
          totalTabPresses: logData.tabPresses,
          totalSuggestionsAccepted: logData.suggestionsAccepted
        },
        acceptedSuggestions: logData.acceptedSuggestions
      };
      
      // Get stats data from chrome.storage.local
      let statsData = {};
      try {
        const result = await chrome.storage.local.get('tabtabgo_stats');
        if (result.tabtabgo_stats && typeof result.tabtabgo_stats === 'object') {
          statsData = result.tabtabgo_stats;
        }
      } catch (error) {
        console.error('[SmartTab] Error loading stats for export:', error);
      }
      
      // Combine both datasets
      const exportData = {
        exportedAt: new Date().toISOString(),
        sessionLog: logContent,
        buttonStats: statsData
      };
      
      const logText = JSON.stringify(exportData, null, 2);
      const blob = new Blob([logText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smarttab-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[SmartTab] Error exporting data:', error);
      // Fallback to just session log if stats fail
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
    hideColorPickerPopup();
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
          
          // Record total selection (Enter/Spacebar press) for this page
          const pageKey = makePageKey();
          recordTotalSelection(pageKey);
          
          // Record button click in stats
          if (!button.isFake) {
            const elementKey = getElementKeyForButton(button);
            recordButtonClicked(pageKey, elementKey);
          }
          
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
    // Load saved color preference
    loadSavedColor();
    
    // Initialize stats store
    initStatsStore();
    
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

