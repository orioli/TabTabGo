(function() {
  'use strict';

  let detectedButtons = [];
  let currentIndex = -1;
  let popupElement = null;
  let detectionTimeout = null;
  let isDetecting = false;
  let autoCloseTimeout = null;
  let colorPickerPopupElement = null;
  let colorPickerOutsideClickHandler = null;
  let selectedColor = '#10b981'; // Default emerald green
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleNavigation') {
      try {
        const wasActive = currentIndex >= 0 && (currentChordElement !== null || currentLassoElement !== null);
        
        if (wasActive) {
          // Navigation is active, close it
          closeSmartNavigation();
          sendResponse({ success: true, navigationActive: false });
        } else {
          // Navigation is not active, start it
          detectedButtons = detectProminentButtons();
          if (detectedButtons.length > 0) {
            currentIndex = -1; // Reset to start
            focusNextButton(); // This will show chord and lasso
            sendResponse({ success: true, navigationActive: true });
          } else {
            sendResponse({ success: false, error: 'No buttons detected on this page' });
          }
        }
      } catch (error) {
        console.error('Error toggling navigation:', error);
        sendResponse({ success: false, error: error.message });
      }
      return true; // Keep channel open for async response
    }
    return false;
  });
  
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
  const MAX_TOP_BUTTONS = 15; // Maximum number of top buttons to show
  
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
    
    // Update existing chord if present
    if (currentChordElement) {
      updateChordColor(color);
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
    
    // Create a lighter version for glow effect
    const rgb = hexToRgb(color);
    const lighterColor = `rgb(${Math.min(255, rgb.r + 50)}, ${Math.min(255, rgb.g + 50)}, ${Math.min(255, rgb.b + 50)})`;
    
    // Update glow (the rect with filter)
    const glowRect = currentLassoElement.querySelector('rect[filter]');
    if (glowRect) {
      glowRect.setAttribute('stroke', lighterColor);
    }
    
    // Update border (the rect without filter - solid color border)
    const rects = currentLassoElement.querySelectorAll('rect');
    rects.forEach(rect => {
      if (!rect.hasAttribute('filter')) {
        rect.setAttribute('stroke', color);
      }
    });
  }
  
  function updateChordColor(color) {
    if (!currentChordElement) return;
    
    const chordColor = hexToRgba(color, 0.8);
    
    // Update glow path
    const glowPath = currentChordElement.querySelector('path[filter]');
    if (glowPath) {
      glowPath.setAttribute('stroke', color);
    }
    
    // Update main chord path
    const chordPath = currentChordElement.querySelector('path:not([filter])');
    if (chordPath) {
      chordPath.setAttribute('stroke', chordColor);
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
          text: 'other',
          selector: 'fake-other',
          isFake: true,
          fakeAction: 'other'
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
  
  // Chord visualization (curved line from cursor to target)
  let currentChordElement = null;
  let currentChordTarget = null;
  let chordUpdateHandler = null;
  let chordMouseMoveHandler = null;
  let currentMouseX = window.innerWidth / 2; // Default to center of screen
  let currentMouseY = window.innerHeight / 2; // Default to center of screen
  
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
    
    // Create defs for filters only (no animated pattern)
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
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
    
    // Create rounded rectangle with lasso effect (static border, no animation)
    const lassoRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    lassoRect.setAttribute('x', rectX);
    lassoRect.setAttribute('y', rectY);
    lassoRect.setAttribute('width', rectWidth);
    lassoRect.setAttribute('height', rectHeight);
    lassoRect.setAttribute('rx', '6');
    lassoRect.setAttribute('ry', '6');
    lassoRect.setAttribute('stroke', selectedColor);
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
  
  // Create chord visualization (curved line from cursor to target button)
  function createChordEffect(element, mouseX, mouseY) {
    // Remove any existing chord
    removeChordEffect();
    
    currentChordTarget = element;
    const rect = element.getBoundingClientRect();
    
    // Target button center point
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height / 2;
    
    // Get color values based on selected color
    const rgb = hexToRgb(selectedColor);
    const chordColor = hexToRgba(selectedColor, 0.8);
    const glowColor = hexToRgba(selectedColor, 0.4);
    
    // Create SVG overlay
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'smarttab-chord';
    svg.style.position = 'fixed';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '999998';
    
    // Create defs for filters
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    // Create filter for blur/glow
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'chord-blur-filter');
    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', '3');
    filter.appendChild(feGaussianBlur);
    defs.appendChild(filter);
    
    svg.appendChild(defs);
    
    // Calculate control points for a smooth curved path
    // Use a cubic bezier curve with control points that create a nice arc
    const dx = targetX - mouseX;
    const dy = targetY - mouseY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // If distance is too small, use a straight line
    if (distance < 5) {
      const pathData = `M ${mouseX} ${mouseY} L ${targetX} ${targetY}`;
      
      // Create glow effect (blurred path behind)
      const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      glowPath.setAttribute('d', pathData);
      glowPath.setAttribute('stroke', selectedColor);
      glowPath.setAttribute('stroke-width', '8');
      glowPath.setAttribute('fill', 'none');
      glowPath.setAttribute('opacity', '0.5');
      glowPath.setAttribute('filter', 'url(#chord-blur-filter)');
      
      // Create main chord path
      const chordPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      chordPath.setAttribute('d', pathData);
      chordPath.setAttribute('stroke', chordColor);
      chordPath.setAttribute('stroke-width', '3');
      chordPath.setAttribute('fill', 'none');
      chordPath.setAttribute('stroke-linecap', 'round');
      chordPath.style.opacity = '1';
      chordPath.style.transition = 'opacity 0.2s';
      
      svg.appendChild(glowPath);
      svg.appendChild(chordPath);
      document.body.appendChild(svg);
      currentChordElement = svg;
      
      // Add scroll, resize, and mousemove handlers to update chord position
      chordUpdateHandler = () => updateChordPosition();
      window.addEventListener('scroll', chordUpdateHandler, true);
      window.addEventListener('resize', chordUpdateHandler);
      
      // Track mouse movement
      chordMouseMoveHandler = (e) => {
        currentMouseX = e.clientX;
        currentMouseY = e.clientY;
        if (currentChordElement && currentChordTarget) {
          updateChordPosition();
        }
      };
      document.addEventListener('mousemove', chordMouseMoveHandler);
      return;
    }
    
    // Control point offset for curve (adjust for a nice arc)
    const curvature = 0.6; // Controls how curved the path is (0-1)
    const baseOffset = Math.min(distance * 0.3, 100); // Limit max offset
    
    // Perpendicular offset for control points (creates arc)
    const perpX = -dy / distance * baseOffset * curvature;
    const perpY = dx / distance * baseOffset * curvature;
    
    const cp1X = mouseX + (targetX - mouseX) * 0.35 + perpX;
    const cp1Y = mouseY + (targetY - mouseY) * 0.35 + perpY;
    const cp2X = mouseX + (targetX - mouseX) * 0.65 + perpX;
    const cp2Y = mouseY + (targetY - mouseY) * 0.65 + perpY;
    
    // Create path string for cubic bezier curve
    const pathData = `M ${mouseX} ${mouseY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;
    
    // Create glow effect (blurred path behind)
    const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glowPath.setAttribute('d', pathData);
    glowPath.setAttribute('stroke', selectedColor);
    glowPath.setAttribute('stroke-width', '8');
    glowPath.setAttribute('fill', 'none');
    glowPath.setAttribute('opacity', '0.5');
    glowPath.setAttribute('filter', 'url(#chord-blur-filter)');
    
    // Create main chord path
    const chordPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chordPath.setAttribute('d', pathData);
    chordPath.setAttribute('stroke', chordColor);
    chordPath.setAttribute('stroke-width', '3');
    chordPath.setAttribute('fill', 'none');
    chordPath.setAttribute('stroke-linecap', 'round');
    chordPath.style.opacity = '1';
    chordPath.style.transition = 'opacity 0.2s';
    
    svg.appendChild(glowPath);
    svg.appendChild(chordPath);
    
    document.body.appendChild(svg);
    currentChordElement = svg;
    
    // Add scroll, resize, and mousemove handlers to update chord position
    chordUpdateHandler = () => updateChordPosition();
    window.addEventListener('scroll', chordUpdateHandler, true);
    window.addEventListener('resize', chordUpdateHandler);
    
    // Track mouse movement
    chordMouseMoveHandler = (e) => {
      currentMouseX = e.clientX;
      currentMouseY = e.clientY;
      if (currentChordElement && currentChordTarget) {
        updateChordPosition();
      }
    };
    document.addEventListener('mousemove', chordMouseMoveHandler);
  }
  
  function updateChordPosition() {
    if (!currentChordElement || !currentChordTarget) return;
    
    const rect = currentChordTarget.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height / 2;
    
    // Recalculate path with current mouse position
    const dx = targetX - currentMouseX;
    const dy = targetY - currentMouseY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    let pathData;
    
    // If distance is too small, use a straight line
    if (distance < 5) {
      pathData = `M ${currentMouseX} ${currentMouseY} L ${targetX} ${targetY}`;
    } else {
      const curvature = 0.6;
      const baseOffset = Math.min(distance * 0.3, 100);
      
      const perpX = -dy / distance * baseOffset * curvature;
      const perpY = dx / distance * baseOffset * curvature;
      
      const cp1X = currentMouseX + (targetX - currentMouseX) * 0.35 + perpX;
      const cp1Y = currentMouseY + (targetY - currentMouseY) * 0.35 + perpY;
      const cp2X = currentMouseX + (targetX - currentMouseX) * 0.65 + perpX;
      const cp2Y = currentMouseY + (targetY - currentMouseY) * 0.65 + perpY;
      
      pathData = `M ${currentMouseX} ${currentMouseY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${targetX} ${targetY}`;
    }
    
    // Update both paths
    const glowPath = currentChordElement.querySelector('path[filter]');
    const chordPath = currentChordElement.querySelector('path:not([filter])');
    
    if (glowPath) glowPath.setAttribute('d', pathData);
    if (chordPath) chordPath.setAttribute('d', pathData);
  }
  
  function removeChordEffect() {
    if (chordUpdateHandler) {
      window.removeEventListener('scroll', chordUpdateHandler, true);
      window.removeEventListener('resize', chordUpdateHandler);
      chordUpdateHandler = null;
    }
    if (chordMouseMoveHandler) {
      document.removeEventListener('mousemove', chordMouseMoveHandler);
      chordMouseMoveHandler = null;
    }
    if (currentChordElement) {
      currentChordElement.remove();
      currentChordElement = null;
    }
    currentChordTarget = null;
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
    } else if (button.fakeAction === 'other') {
      // "other" is just for display - no special action needed
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
      // For fake buttons, just close navigation
      closeSmartNavigation();
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
      
      // Add emerald lasso effect around button
      createLassoEffect(button.element);
      
      // Add chord visualization from cursor to button
      createChordEffect(button.element, currentMouseX, currentMouseY);
      
      // Refresh button list after focusing
      setTimeout(() => {
        detectedButtons = detectProminentButtons();
        if (currentIndex >= detectedButtons.length) {
          currentIndex = -1;
        }
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
          <span class="smarttab-copyright">How to cite: Guirao, C., & Berengueres, J. (2025). TabTab Go (v1.0.5) [Computer software]. Nazarbayev University. https://github.com/orioli/tabtabgo</span>
        </div>
        <div class="smarttab-header-actions">
          <button class="smarttab-color-picker" id="smarttab-color-picker-btn" title="Change color">🎨</button>
          <button class="smarttab-close" id="smarttab-close-btn" title="Close">×</button>
        </div>
      </div>
      <div class="smarttab-list" id="smarttab-list">
        ${detectedButtons.map((btn, index) => {
          const isActive = index === currentIndex;
          const activeBgColor = isActive ? getLightBackgroundColor(selectedColor) : '';
          const activeStyle = isActive ? `style="background-color: ${activeBgColor}; border-left-color: ${selectedColor};"` : '';
          
          return `
          <div class="smarttab-item ${isActive ? 'active' : ''}" 
               data-index="${index}"
               ${activeStyle}>
            <span class="smarttab-number" ${isActive ? `style="background: ${selectedColor};"` : ''}>${index + 1}</span>
            <span class="smarttab-text" ${isActive ? `style="color: ${selectedColor};"` : ''}>${escapeHtml(btn.text)}</span>
          </div>
        `;
        }).join('')}
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
    
    const colorPickerBtn = popupElement.querySelector('#smarttab-color-picker-btn');
    if (colorPickerBtn) {
      colorPickerBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleColorPickerPopup(colorPickerBtn);
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
        
        return `
        <div class="smarttab-item ${isActive ? 'active' : ''}" 
             data-index="${index}"
             ${activeStyle}>
          <span class="smarttab-number" ${isActive ? `style="background: ${selectedColor};"` : ''}>${index + 1}</span>
          <span class="smarttab-text" ${isActive ? `style="color: ${selectedColor};"` : ''}>${escapeHtml(btn.text)}</span>
        </div>
      `;
      }).join('');
      
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

  // Show popup (now hidden by default - chord visualization replaces it)
  function showPopup() {
    // Don't show popup - use chord visualization instead
    // if (popupElement) {
    //   popupElement.style.display = 'block';
    // } else {
    //   createPopup();
    // }
    // Reset auto-close timer when popup is shown
    // resetAutoCloseTimer();
  }

  // Hide popup and reset navigation state
  function hidePopup() {
    if (popupElement) {
      popupElement.style.display = 'none';
    }
    hideColorPickerPopup();
    // Reset current index so next Tab press triggers fresh detection
    currentIndex = -1;
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
    removeChordEffect(); // Remove chord when closing navigation
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
      // For fake buttons, just close navigation
      closeSmartNavigation();
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
      
      // Add emerald lasso effect around button
      createLassoEffect(button.element);
      
      // Add chord visualization from cursor to button
      createChordEffect(button.element, currentMouseX, currentMouseY);
      
      return true;
    } catch (e) {
      console.error('Error focusing button:', e);
      return false;
    }
  }

  // Intercept Tab key, D key (forward), and S key (backward)
  function interceptTab(event) {
    const isTab = event.key === 'Tab';
    const isD = event.key === 'd' || event.key === 'D' || event.key === 'В' || event.key === 'в'; // Cyrillic В
    const isS = event.key === 's' || event.key === 'S' || event.key === 'Ы' || event.key === 'ы'; // Cyrillic Ы
    
    if ((isTab || isD || isS) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Only intercept if we're not in an input field or text area
      const activeElement = document.activeElement;
      
      // Check if we're in a text input field
      let isInputField = false;
      if (activeElement) {
        const tagName = activeElement.tagName;
        const type = activeElement.type ? activeElement.type.toLowerCase() : '';
        
        // Check for textarea
        if (tagName === 'TEXTAREA') {
          isInputField = true;
        }
        // Check for input elements that accept text
        else if (tagName === 'INPUT') {
          // Don't intercept for text inputs, but allow for buttons, checkboxes, etc.
          const textInputTypes = ['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week'];
          if (textInputTypes.includes(type) || !type || type === '') {
            isInputField = true;
          }
        }
        // Check for contentEditable elements (rich text editors)
        else if (activeElement.isContentEditable) {
          isInputField = true;
        }
      }

      // Only intercept if we're NOT in an input field
      if (!isInputField) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation(); // Stop other handlers from running
        
        // If popup was closed, reset state for fresh detection
        if (detectedButtons.length === 0 || currentIndex === -1) {
          detectedButtons = [];
          currentIndex = -1;
        }
        
        // Determine direction: Tab uses shiftKey, S is backward, D is forward
        let backward = false;
        if (isTab) {
          backward = event.shiftKey;
        } else if (isS) {
          backward = true; // S key is backward
        } else if (isD) {
          backward = false; // D key is forward
        }
        
        if (focusNextButton(backward)) {
          resetAutoCloseTimer(); // Reset timer on key interaction
          return false;
        }
      }
    }
    return true;
  }
  
  // Intercept Enter, Space, and W keys to close smart navigation when button is activated
  function interceptActivationKeys(event) {
    const isEnter = event.key === 'Enter';
    const isSpace = event.key === ' ' || event.code === 'Space' || event.key === 'Spacebar';
    const isW = event.key === 'w' || event.key === 'W' || event.key === 'Ц' || event.key === 'ц'; // Cyrillic Ц
    
    if ((isEnter || isSpace || isW) && !event.ctrlKey && !event.altKey && !event.metaKey) {
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
        const isButtonFocused = activeElement && button.element === activeElement;
        
        // For W key, always activate if we have a button selected (even if not focused)
        // For Enter/Space, only activate if button is focused
        if (isW || isButtonFocused) {
          // Prevent default for W key to avoid typing 'w'
          if (isW) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          }
          
          // For W key, programmatically click the button
          if (isW) {
            try {
              // Ensure button is focused first
              if (button.element.focus) {
                button.element.focus();
              }
              // Click the button
              if (button.element.click) {
                button.element.click();
              } else {
                // Fallback: dispatch a click event
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                button.element.dispatchEvent(clickEvent);
              }
            } catch (e) {
              console.error('Error clicking button with W key:', e);
            }
          }
          
          // Close smart navigation
          closeSmartNavigation();
          
          // For Enter/Space, let the event proceed normally to activate the button
          // For W, we've already clicked it, so prevent further propagation
          return isW ? false : true;
        }
      }
    }
    return true;
  }

  // Intercept ESC and A keys to close smart navigation and hide chords/boxes
  function interceptEscape(event) {
    const isEscape = event.key === 'Escape';
    const isA = event.key === 'a' || event.key === 'A' || event.key === 'Ф' || event.key === 'ф'; // Cyrillic Ф
    
    if ((isEscape || isA) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Check if chord or lasso is visible
      const hasChord = currentChordElement !== null;
      const hasLasso = currentLassoElement !== null;
      
      if (hasChord || hasLasso || (popupElement && popupElement.style.display !== 'none')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeSmartNavigation();
        return false;
      }
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
    
    // Initialize mouse position tracking
    document.addEventListener('mousemove', (e) => {
      currentMouseX = e.clientX;
      currentMouseY = e.clientY;
    });
    
    // Detect buttons on page load (with a small delay to let page settle)
    setTimeout(() => {
      detectedButtons = detectProminentButtons();
      // Popup is no longer shown - chord visualization is used instead
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
    
    // Track clicks outside detected buttons as "other"
    document.addEventListener('click', (event) => {
      const clickedElement = event.target;
      
      // Ignore clicks on our own UI elements
      if (clickedElement.closest('#smarttab-popup') ||
          clickedElement.closest('#smarttab-color-picker-popup') ||
          clickedElement.closest('#smarttab-lasso')) {
        return;
      }
      
      // Check if the clicked element is one of the detected buttons (or a child of one)
      let isDetectedButton = false;
      for (const button of detectedButtons) {
        if (button.element && (button.element === clickedElement || button.element.contains(clickedElement))) {
          isDetectedButton = true;
          break;
        }
      }
      
      // If it's not a detected button, check if it's a clickable element
      if (!isDetectedButton) {
        const tagName = clickedElement.tagName?.toLowerCase();
        const role = clickedElement.getAttribute?.('role');
        // Click tracking removed - no data collection
      }
    }, true);
    
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
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

