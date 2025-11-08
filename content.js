// Intercept fetch requests to capture inventory data
(function() {
  'use strict';

  let hasProcessedData = false;
  // Global storage for charm templates (assetid -> charm value)
  const charmTemplateMap = new Map();
  // Track all displayed charm items
  let allDisplayedCharms = [];
  // Track current Steam ID to detect inventory changes
  let currentSteamId = null;
  
  // Special "Charm" numbers that get a star
  const specialCharmNumbers = new Set([
    101, 8008, 80085, 12345, 666, 404, 911, 420, 1337, 69, 6969, 42069, 69420,
    11, 22, 33, 55, 66, 88, 111, 222, 333, 444, 555, 666, 777, 888, 999,
    1111, 2222, 3333, 4444, 5555, 6666, 7777, 8888, 9999,
    11111, 22222, 33333, 44444, 55555, 66666, 77777, 88888, 99999,
    10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 1
  ]);
  console.log('Special charm numbers loaded:', specialCharmNumbers.size, 'total');
  
  // Check if a charm value is a special charm
  function isSpecialCharm(value) {
    return specialCharmNumbers.has(value);
  }
  
  // Check if we're on an inventory page
  function isOnInventoryPage() {
    return window.location.pathname.includes('/inventory') || 
           (window.location.pathname.includes('/profiles/') && window.location.hash.includes('inventory')) ||
           (window.location.pathname.includes('/id/') && window.location.hash.includes('inventory'));
  }
  
  // Function to clear all charm data
  function clearCharmData() {
    charmTemplateMap.clear();
    allDisplayedCharms = [];
    isScanningComplete = false;
    // Remove existing overlays
    document.querySelectorAll('.charm-overlay').forEach(el => el.remove());
    // Remove existing panel
    const panel = document.getElementById('charm-template-panel');
    if (panel) {
      panel.remove();
    }
    // Reset button state
    const scanBtn = document.getElementById('charm-scan-btn');
    if (scanBtn) {
      scanBtn.style.display = 'flex';
      updateButtonState();
    }
  }
  
  // Detect Steam ID from current page
  function detectCurrentSteamId() {
    // Direct profile URL with numeric ID
    const urlMatch = window.location.pathname.match(/\/profiles\/(\d+)/);
    if (urlMatch) return urlMatch[1];
    
    // Direct inventory URL with numeric ID
    const inventoryMatch = window.location.pathname.match(/\/inventory\/(\d+)/);
    if (inventoryMatch) return inventoryMatch[1];
    
    // Vanity URL - need to extract Steam ID from page variables
    const vanityMatch = window.location.pathname.match(/\/id\/([^\/]+)/);
    if (vanityMatch) {
      // Try UserYou object (set via UserYou.SetSteamId)
      if (typeof UserYou !== 'undefined' && UserYou.strSteamId) {
        return UserYou.strSteamId;
      }
      
      // Try g_rgProfileData which contains the profile being viewed
      if (typeof g_rgProfileData !== 'undefined' && g_rgProfileData.steamid) {
        return g_rgProfileData.steamid;
      }
      
      // Parse the page HTML for UserYou.SetSteamId call
      const scriptMatch = document.documentElement.innerHTML.match(/UserYou\.SetSteamId\(\s*['"](\d+)['"]\s*\)/);
      if (scriptMatch) {
        return scriptMatch[1];
      }
    }
    
    return null;
  }
  
  // Check if we've navigated to a different inventory
  function checkInventoryChange() {
    const detectedSteamId = detectCurrentSteamId();
    if (detectedSteamId && detectedSteamId !== currentSteamId) {
      console.log('Inventory changed from', currentSteamId, 'to', detectedSteamId, '| URL:', window.location.pathname);
      clearCharmData();
      currentSteamId = detectedSteamId;
      
      // Automatically scan the new inventory
      if (isOnInventoryPage()) {
        setTimeout(() => {
          performAutomaticScan();
        }, 2000);
      }
    }
  }
  
  // Initialize current Steam ID
  currentSteamId = detectCurrentSteamId();
  if (currentSteamId) {
    console.log('Extension initialized for Steam ID:', currentSteamId, '| URL:', window.location.pathname);
  }

  // Store original fetch
  const originalFetch = window.fetch;
  
  // Override fetch to intercept Steam inventory responses
  window.fetch = async function(...args) {
    try {
      const response = await originalFetch.apply(this, args);
      
      // Check if this is an inventory request (both context 2 and 16)
      const url = args[0];
      if (typeof url === 'string' && url.includes('/inventory/') && url.includes('/730/') && 
          (url.includes('/730/2') || url.includes('/730/16'))) {
        // Clone response so we can read it
        const clonedResponse = response.clone();
        
        try {
          const data = await clonedResponse.json();
          const isTradeProtected = url.includes('/730/16');
          processInventoryData(data, isTradeProtected);
        } catch (e) {
          console.error('Error parsing inventory data:', e);
        }
      }
      
      return response;
    } catch (e) {
      console.error('Error in fetch override:', e);
      throw e;
    }
  };

  // Also intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const xhr = this;
    this.addEventListener('load', function() {
      if (this._url && this._url.includes('/inventory/') && this._url.includes('/730/') &&
          (this._url.includes('/730/2') || this._url.includes('/730/16'))) {
        try {
          const data = JSON.parse(this.responseText);
          const isTradeProtected = this._url.includes('/730/16');
          processInventoryData(data, isTradeProtected);
        } catch (e) {
          console.error('Error parsing inventory data:', e);
        }
      }
    });
    return originalSend.apply(this, args);
  };

  function processInventoryData(data, isTradeProtected = false) {
    console.log('Processing inventory data...', data, 'Trade Protected:', isTradeProtected);
    
    if (!data || !data.assets) {
      console.log('No data or assets found');
      return;
    }

    const charmItems = [];
    
    // Create a map of assetid to asset_properties
    // The asset_properties are in a SEPARATE array at the root level
    const assetPropertiesMap = {};
    
    if (data.asset_properties && Array.isArray(data.asset_properties)) {
      console.log('Found asset_properties array with', data.asset_properties.length, 'entries');
      data.asset_properties.forEach(propObj => {
        if (propObj.assetid && propObj.asset_properties) {
          assetPropertiesMap[propObj.assetid] = propObj.asset_properties;
        }
      });
    }
    
    // Create descriptions map for item names
    const descriptionsMap = {};
    if (data.descriptions) {
      data.descriptions.forEach(desc => {
        const key = `${desc.classid}_${desc.instanceid}`;
        descriptionsMap[key] = desc;
      });
    }

    // Process each asset
    data.assets.forEach(asset => {
      const properties = assetPropertiesMap[asset.assetid];
      
      if (properties) {
        const charmTemplate = properties.find(
          prop => prop.name === 'Charm Template'
        );

        if (charmTemplate) {
          const key = `${asset.classid}_${asset.instanceid}`;
          const description = descriptionsMap[key];
          const itemName = description ? description.name : 'Unknown Item';
          
          console.log('Found charm:', charmTemplate.int_value, 'for', itemName, '(assetid:', asset.assetid + ')', isTradeProtected ? '[TRADE PROTECTED]' : '[TRADABLE]');
          
          // Store in global map for preview tab updates
          charmTemplateMap.set(asset.assetid, {
            value: parseInt(charmTemplate.int_value),
            tradeProtected: isTradeProtected
          });
          
          // Get icon URL from description (prefer large icon if available)
          let iconUrl = null;
          if (description) {
            if (description.icon_url_large) {
              iconUrl = `https://community.fastly.steamstatic.com/economy/image/${description.icon_url_large}`;
            } else if (description.icon_url) {
              iconUrl = `https://community.fastly.steamstatic.com/economy/image/${description.icon_url}`;
            }
          }
          
          charmItems.push({
            assetid: asset.assetid,
            charmValue: parseInt(charmTemplate.int_value),
            name: itemName,
            classid: asset.classid,
            instanceid: asset.instanceid,
            tradeProtected: isTradeProtected,
            iconUrl: iconUrl
          });
        }
      }
    });

    if (charmItems.length > 0) {
      console.log('Total charms found:', charmItems.length);
      storeCharmData(charmItems);
      // Add overlays to inventory items
      setTimeout(() => addCharmOverlays(), 500);
    }
  }

  function storeCharmData(charmItems) {
    // Merge new items with existing items (avoid duplicates by assetid)
    const existingAssetIds = new Set(allDisplayedCharms.map(item => item.assetid));
    const newItems = charmItems.filter(item => !existingAssetIds.has(item.assetid));
    allDisplayedCharms = [...allDisplayedCharms, ...newItems];
    
    // Update button text to show charms are available
    updateButtonState();
  }

  // Function to show help popup
  function showHelpPopup() {
    // Remove existing help popup if present
    const existingPopup = document.getElementById('charm-help-popup');
    if (existingPopup) {
      existingPopup.remove();
      return;
    }

    // Create popup overlay
    const overlay = document.createElement('div');
    overlay.id = 'charm-help-popup';
    overlay.className = 'charm-help-overlay';
    
    overlay.innerHTML = `
      <div class="charm-help-popup">
        <div class="charm-help-header">
          <h3>Need Help?</h3>
          <button id="charm-help-close">×</button>
        </div>
        <div class="charm-help-content">
          <p>For bug reports or further assistance, please add me on Discord:</p>
          <div class="charm-discord-tag">1kevko</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Close button functionality
    document.getElementById('charm-help-close').addEventListener('click', () => {
      overlay.remove();
    });
    
    // Copy Discord tag to clipboard when clicked
    const discordTag = overlay.querySelector('.charm-discord-tag');
    discordTag.style.cursor = 'pointer';
    discordTag.addEventListener('click', async () => {
      const text = discordTag.textContent;
      try {
        await navigator.clipboard.writeText(text);
        const originalText = discordTag.textContent;
        discordTag.textContent = 'Copied!';
        setTimeout(() => {
          discordTag.textContent = originalText;
        }, 1000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
    
    // Close when clicking outside
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  function displayCharmTemplates() {
    // Use the stored charm data
    if (allDisplayedCharms.length === 0) {
      alert('No charms found. Please wait for the automatic scan to complete or try refreshing the page.');
      return;
    }
    
    // Remove existing panel if present
    const existingPanel = document.getElementById('charm-template-panel');
    if (existingPanel) {
      existingPanel.remove();
    }

    // Disable button while panel is visible
    const scanBtn = document.getElementById('charm-scan-btn');
    if (scanBtn) {
      scanBtn.disabled = true;
      scanBtn.style.opacity = '0.5';
      scanBtn.style.cursor = 'not-allowed';
    }

    // Create panel
    const panel = document.createElement('div');
    panel.id = 'charm-template-panel';
    panel.className = 'charm-panel';

    // Count tradable vs trade-protected from all items
    const tradableCount = allDisplayedCharms.filter(item => !item.tradeProtected).length;
    const tradeProtectedCount = allDisplayedCharms.filter(item => item.tradeProtected).length;
    
    // Track current sort and filter state
    let currentSort = 'value'; // 'value' or 'name'
    let sortDirection = 'desc'; // 'desc' or 'asc'
    let showOnlySpecial = false;
    let showTradeLocked = true;
    let searchQuery = '';
    let rangeMin = 0;
    let rangeMax = 100000;
    const baseGridSize = 60; // Base grid size in px
    let gridSize = baseGridSize; // Current grid size in px
    let gridSizeDecreaseClicks = 0; // Track decrease clicks from base (max 2)
    let gridSizeIncreaseClicks = 0; // Track increase clicks from base (max 2)
    
    // Create header
    const header = document.createElement('div');
    header.className = 'charm-header';
    
    // Count special charms
    const specialCount = allDisplayedCharms.filter(item => isSpecialCharm(parseInt(item.charmValue))).length;
    
    header.innerHTML = `
      <div class="charm-header-buttons">
        <button id="charm-guide-btn" title="View Steam Guide">📖 Guide</button>
        <button id="charm-help-btn" title="Get help">❓ Help</button>
        <button id="charm-donate-btn" title="Support the developer">💝 Donate</button>
        <button id="charm-export-btn" title="Export to text file">💾 Export</button>
        <button id="charm-close-btn">×</button>
      </div>
    `;

    // Create controls area
    const controls = document.createElement('div');
    controls.className = 'charm-controls';
    controls.innerHTML = `
      <div class="charm-controls-top-row">
        <div class="charm-sort-controls">
          <label>Sort:</label>
          <button id="charm-sort-value" class="charm-sort-btn active"><span class="sort-arrow">▼</span> Pattern</button>
          <button id="charm-sort-name" class="charm-sort-btn"><span class="sort-arrow">▼</span> Name</button>
        </div>
        <div class="charm-search-controls">
          <input type="text" id="charm-search-input" placeholder="Search items..." />
          <button id="charm-search-clear" title="Clear search">✕</button>
        </div>
      </div>
      <div class="charm-range-controls">
        <label>Range:</label>
        <div class="charm-range-slider-wrapper">
          <div class="charm-range-slider-track"></div>
          <div class="charm-range-slider-range" id="slider-range"></div>
          <input type="range" id="charm-range-slider-min" class="charm-range-slider" min="0" max="100000" value="0" step="100">
          <input type="range" id="charm-range-slider-max" class="charm-range-slider" min="0" max="100000" value="100000" step="100">
        </div>
        <div class="charm-range-inputs">
          <input type="number" id="charm-range-min" min="0" max="100000" value="0" placeholder="Min">
          <span class="range-separator">-</span>
          <input type="number" id="charm-range-max" min="0" max="100000" value="100000" placeholder="Max">
        </div>
      </div>
      <div class="charm-filter-controls">
        <label>
          <input type="checkbox" id="charm-filter-special">
          Show only special numbers
        </label>
        <label>
          <input type="checkbox" id="charm-filter-tradelocked" checked>
          Show trade-locked items
        </label>
      </div>
      <div class="charm-counts">
        <span>Total: <span id="charm-count-total">${allDisplayedCharms.length}</span></span>
        <span>Tradable: <span id="charm-count-tradable">${tradableCount}</span></span>
        <span>Locked: <span id="charm-count-locked">${tradeProtectedCount}</span></span>
        <span>Special: <span id="charm-count-special">${specialCount}</span></span>
        <button id="charm-grid-decrease" class="charm-grid-size-btn" title="Decrease grid size">−</button>
        <button id="charm-grid-increase" class="charm-grid-size-btn" title="Increase grid size">+</button>
        <button id="charm-showcase-btn" class="charm-grid-size-btn" title="Open showcase window">⛶</button>
      </div>
    `;

    // Create content area
    const content = document.createElement('div');
    content.className = 'charm-content';

    // Function to render the list based on current filters and sort
    function renderCharmList() {
      // Filter items
      let itemsToShow = [...allDisplayedCharms];
      if (showOnlySpecial) {
        itemsToShow = itemsToShow.filter(item => isSpecialCharm(parseInt(item.charmValue)));
      }
      if (!showTradeLocked) {
        itemsToShow = itemsToShow.filter(item => !item.tradeProtected);
      }
      // Filter by search query
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        itemsToShow = itemsToShow.filter(item => 
          item.name.toLowerCase().includes(query) || 
          item.charmValue.toString().includes(query)
        );
      }
      // Filter by pattern range
      itemsToShow = itemsToShow.filter(item => 
        item.charmValue >= rangeMin && item.charmValue <= rangeMax
      );
      
      // Sort items
      if (currentSort === 'value') {
        if (sortDirection === 'desc') {
          itemsToShow.sort((a, b) => b.charmValue - a.charmValue);
        } else {
          itemsToShow.sort((a, b) => a.charmValue - b.charmValue);
        }
      } else {
        if (sortDirection === 'desc') {
          itemsToShow.sort((a, b) => b.name.localeCompare(a.name));
        } else {
          itemsToShow.sort((a, b) => a.name.localeCompare(b.name));
        }
      }
      
      // Update count displays
      const filteredTradableCount = itemsToShow.filter(item => !item.tradeProtected).length;
      const filteredTradeProtectedCount = itemsToShow.filter(item => item.tradeProtected).length;
      const filteredSpecialCount = itemsToShow.filter(item => isSpecialCharm(parseInt(item.charmValue))).length;
      
      const countTotal = document.getElementById('charm-count-total');
      const countTradable = document.getElementById('charm-count-tradable');
      const countLocked = document.getElementById('charm-count-locked');
      const countSpecial = document.getElementById('charm-count-special');
      
      if (countTotal) countTotal.textContent = itemsToShow.length;
      if (countTradable) countTradable.textContent = filteredTradableCount;
      if (countLocked) countLocked.textContent = filteredTradeProtectedCount;
      if (countSpecial) countSpecial.textContent = filteredSpecialCount;
      
      // Clear content
      content.innerHTML = '';
      
      // Create grid container
      const gridContainer = document.createElement('div');
      gridContainer.className = 'charm-grid-container';
      gridContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${gridSize}px, 1fr))`;
      
      // Add items to grid
      itemsToShow.forEach((item, index) => {
        const itemHolder = document.createElement('div');
        itemHolder.className = 'charm-item-holder';
        
        const itemDiv = document.createElement('div');
        itemDiv.className = 'charm-item-preview';
        
        const charmVal = parseInt(item.charmValue);
        const isSpecial = isSpecialCharm(charmVal);
        
        if (isSpecial) {
          itemDiv.classList.add('special-charm-item');
        }
        
        // Set border color (yellow for special, default for others)
        if (isSpecial) {
          itemDiv.style.borderColor = 'rgb(255, 215, 0)';
        } else {
          itemDiv.style.borderColor = 'rgb(210, 210, 210)';
        }
        
        // Create image
        const img = document.createElement('img');
        if (item.iconUrl) {
          img.src = item.iconUrl;
          img.alt = item.name;
        } else {
          // Fallback placeholder
          img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
        }
        
        // Create charm overlay
        const overlay = document.createElement('div');
        overlay.className = 'charm-overlay';
        if (item.tradeProtected) {
          overlay.classList.add('trade-protected');
        }
        overlay.textContent = item.charmValue;
        
        // Create trade protection badge
        let tradeBadge = null;
        if (item.tradeProtected) {
          tradeBadge = document.createElement('div');
          tradeBadge.className = 'provisional_item_badge';
          tradeBadge.setAttribute('data-tooltip-text', 'Trade protected items cannot be modified, consumed, or transferred.');
        }
        
        // Create star for special charms
        let star = null;
        if (isSpecial) {
          star = document.createElement('div');
          star.className = 'special-charm-star';
          star.textContent = '⭐';
        }
        
        // Append elements
        itemDiv.appendChild(img);
        if (tradeBadge) {
          itemDiv.appendChild(tradeBadge);
        }
        if (star) {
          itemDiv.appendChild(star);
        }
        itemDiv.appendChild(overlay);
        
        itemHolder.appendChild(itemDiv);
        gridContainer.appendChild(itemHolder);
      });
      
      content.appendChild(gridContainer);
      
      return itemsToShow;
    }

    // Initial render
    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(content);
    document.body.appendChild(panel);
    
    let currentCharmList = renderCharmList();

    // Function to update sort arrow
    function updateSortArrow(buttonId, direction) {
      const button = document.getElementById(buttonId);
      if (button) {
        const arrow = button.querySelector('.sort-arrow');
        if (arrow) {
          arrow.textContent = direction === 'desc' ? '▼' : '▲';
        }
      }
    }
    
    // Add sort button functionality
    document.getElementById('charm-sort-value').addEventListener('click', () => {
      if (currentSort === 'value') {
        // Toggle direction if clicking the same button
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        // Switch to value sort with default descending
        currentSort = 'value';
        sortDirection = 'desc';
      }
      document.getElementById('charm-sort-value').classList.add('active');
      document.getElementById('charm-sort-name').classList.remove('active');
      updateSortArrow('charm-sort-value', sortDirection);
      updateSortArrow('charm-sort-name', 'desc');
      currentCharmList = renderCharmList();
    });
    
    document.getElementById('charm-sort-name').addEventListener('click', () => {
      if (currentSort === 'name') {
        // Toggle direction if clicking the same button
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        // Switch to name sort with default descending (Z to A)
        currentSort = 'name';
        sortDirection = 'desc';
      }
      document.getElementById('charm-sort-name').classList.add('active');
      document.getElementById('charm-sort-value').classList.remove('active');
      updateSortArrow('charm-sort-name', sortDirection);
      updateSortArrow('charm-sort-value', 'desc');
      currentCharmList = renderCharmList();
    });
    
    // Add filter checkbox functionality
    document.getElementById('charm-filter-special').addEventListener('change', (e) => {
      showOnlySpecial = e.target.checked;
      currentCharmList = renderCharmList();
    });
    
    document.getElementById('charm-filter-tradelocked').addEventListener('change', (e) => {
      showTradeLocked = e.target.checked;
      currentCharmList = renderCharmList();
    });
    
    // Add search functionality
    const searchInput = document.getElementById('charm-search-input');
    const searchClearBtn = document.getElementById('charm-search-clear');
    
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      currentCharmList = renderCharmList();
      searchClearBtn.style.display = searchQuery.trim() !== '' ? 'flex' : 'none';
    });
    
    searchClearBtn.addEventListener('click', () => {
      searchQuery = '';
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      currentCharmList = renderCharmList();
    });
    
    // Initially hide clear button
    searchClearBtn.style.display = 'none';
    
    // Add range filter functionality
    const rangeMinInput = document.getElementById('charm-range-min');
    const rangeMaxInput = document.getElementById('charm-range-max');
    const rangeSliderMin = document.getElementById('charm-range-slider-min');
    const rangeSliderMax = document.getElementById('charm-range-slider-max');
    const sliderRange = document.getElementById('slider-range');
    
    // Function to update the visual range indicator
    function updateSliderRange() {
      const percentMin = (rangeMin / 100000) * 100;
      const percentMax = (rangeMax / 100000) * 100;
      sliderRange.style.left = percentMin + '%';
      sliderRange.style.width = (percentMax - percentMin) + '%';
    }
    
    // Initial range update
    updateSliderRange();
    
    // Update from number inputs
    rangeMinInput.addEventListener('input', (e) => {
      const newValue = Math.max(0, Math.min(100000, parseInt(e.target.value) || 0));
      rangeMin = newValue;
      rangeSliderMin.value = rangeMin;
      updateSliderRange();
      currentCharmList = renderCharmList();
    });
    
    // Validate min on blur (when user finishes editing)
    rangeMinInput.addEventListener('blur', (e) => {
      const newValue = Math.max(0, Math.min(100000, parseInt(e.target.value) || 0));
      rangeMin = newValue;
      // Ensure min doesn't exceed max
      if (rangeMin > rangeMax) {
        rangeMax = rangeMin;
        rangeMaxInput.value = rangeMax;
        rangeSliderMax.value = rangeMax;
      }
      rangeMinInput.value = rangeMin;
      rangeSliderMin.value = rangeMin;
      updateSliderRange();
      currentCharmList = renderCharmList();
    });
    
    rangeMaxInput.addEventListener('input', (e) => {
      const newValue = Math.max(0, Math.min(100000, parseInt(e.target.value) || 100000));
      rangeMax = newValue;
      rangeSliderMax.value = rangeMax;
      updateSliderRange();
      currentCharmList = renderCharmList();
    });
    
    // Validate max on blur (when user finishes editing)
    rangeMaxInput.addEventListener('blur', (e) => {
      const newValue = Math.max(0, Math.min(100000, parseInt(e.target.value) || 100000));
      rangeMax = newValue;
      // Ensure max doesn't go below min
      if (rangeMax < rangeMin) {
        rangeMin = rangeMax;
        rangeMinInput.value = rangeMin;
        rangeSliderMin.value = rangeMin;
      }
      rangeMaxInput.value = rangeMax;
      rangeSliderMax.value = rangeMax;
      updateSliderRange();
      currentCharmList = renderCharmList();
    });
    
    // Update from sliders
    rangeSliderMin.addEventListener('input', (e) => {
      rangeMin = parseInt(e.target.value);
      rangeMinInput.value = rangeMin;
      // Ensure min doesn't exceed max
      if (rangeMin > rangeMax) {
        rangeMax = rangeMin;
        rangeMaxInput.value = rangeMax;
        rangeSliderMax.value = rangeMax;
      }
      updateSliderRange();
      currentCharmList = renderCharmList();
    });
    
    rangeSliderMax.addEventListener('input', (e) => {
      rangeMax = parseInt(e.target.value);
      rangeMaxInput.value = rangeMax;
      // Ensure max doesn't go below min
      if (rangeMax < rangeMin) {
        rangeMin = rangeMax;
        rangeMinInput.value = rangeMin;
        rangeSliderMin.value = rangeMin;
      }
      updateSliderRange();
      currentCharmList = renderCharmList();
    });
    
    // Grid size controls
    const gridDecreaseBtn = document.getElementById('charm-grid-decrease');
    const gridIncreaseBtn = document.getElementById('charm-grid-increase');
    
    // Function to update grid size
    function updateGridSize() {
      // Calculate grid size from base and click counts
      // For increases above 60px: first click = 80px, second click = 100px
      if (gridSizeIncreaseClicks > 0) {
        if (gridSizeIncreaseClicks === 1) {
          gridSize = 80;
        } else if (gridSizeIncreaseClicks === 2) {
          gridSize = 100;
        }
      } else {
        // For decreases: 60 → 50 → 40
        gridSize = baseGridSize - (gridSizeDecreaseClicks * 10);
      }
      
      const gridContainer = document.querySelector('.charm-grid-container');
      if (gridContainer) {
        gridContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${gridSize}px, 1fr))`;
      }
      // Update button states
      if (gridDecreaseBtn) {
        gridDecreaseBtn.disabled = gridSizeDecreaseClicks >= 2;
        gridDecreaseBtn.style.opacity = gridSizeDecreaseClicks >= 2 ? '0.5' : '1';
      }
      if (gridIncreaseBtn) {
        gridIncreaseBtn.disabled = gridSizeIncreaseClicks >= 2;
        gridIncreaseBtn.style.opacity = gridSizeIncreaseClicks >= 2 ? '0.5' : '1';
      }
    }
    
    // Initial grid size update
    updateGridSize();
    
    // Decrease button handler
    gridDecreaseBtn.addEventListener('click', () => {
      if (gridSizeDecreaseClicks < 2) {
        // If we were increased, reduce that first
        if (gridSizeIncreaseClicks > 0) {
          gridSizeIncreaseClicks--;
        } else {
          // Otherwise increase decrease clicks
          gridSizeDecreaseClicks++;
        }
        updateGridSize();
      }
    });
    
    // Increase button handler
    gridIncreaseBtn.addEventListener('click', () => {
      if (gridSizeIncreaseClicks < 2) {
        // If we were decreased, reduce that first
        if (gridSizeDecreaseClicks > 0) {
          gridSizeDecreaseClicks--;
        } else {
          // Otherwise increase increase clicks
          gridSizeIncreaseClicks++;
        }
        updateGridSize();
      }
    });

    // Add guide button functionality
    document.getElementById('charm-guide-btn').addEventListener('click', () => {
      window.open('https://steamcommunity.com/sharedfiles/filedetails/?id=3562046352', '_blank');
    });

    // Add help button functionality
    document.getElementById('charm-help-btn').addEventListener('click', () => {
      showHelpPopup();
    });

    // Add donate button functionality
    document.getElementById('charm-donate-btn').addEventListener('click', () => {
      window.open('https://steamcommunity.com/tradeoffer/new/?partner=260378764&token=9SwMj2MY', '_blank');
    });

    // Add close button functionality
    document.getElementById('charm-close-btn').addEventListener('click', () => {
      panel.remove();
      // Re-enable button using updateButtonState (don't clear data)
      updateButtonState();
    });

    // Add export button functionality
    document.getElementById('charm-export-btn').addEventListener('click', () => {
      const filteredTradableCount = currentCharmList.filter(item => !item.tradeProtected).length;
      const filteredTradeProtectedCount = currentCharmList.filter(item => item.tradeProtected).length;
      exportCharmList(currentCharmList, filteredTradableCount, filteredTradeProtectedCount);
    });

    // Add showcase button functionality
    document.getElementById('charm-showcase-btn').addEventListener('click', () => {
      openShowcaseWindow(currentCharmList);
    });

    // Make panel draggable
    makeDraggable(panel, header);
  }

  // Function to open showcase window
  function openShowcaseWindow(charms) {
    if (!charms || charms.length === 0) {
      alert('No charms to showcase. Please wait for the scan to complete or adjust your filters.');
      return;
    }

    // Calculate stats
    const tradableCount = charms.filter(item => !item.tradeProtected).length;
    const lockedCount = charms.filter(item => item.tradeProtected).length;
    const specialCount = charms.filter(item => isSpecialCharm(parseInt(item.charmValue))).length;

    // Create HTML content for the showcase window
    let gridHTML = '';
    charms.forEach((item) => {
      const charmVal = parseInt(item.charmValue);
      const isSpecial = isSpecialCharm(charmVal);
      const borderColor = isSpecial ? 'rgb(255, 215, 0)' : 'rgb(210, 210, 210)';
      const specialClass = isSpecial ? 'special-charm-item' : '';
      
      // Escape HTML in item name for safety
      const safeIconUrl = (item.iconUrl || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==').replace(/"/g, '&quot;');
      
      gridHTML += `
        <div class="showcase-item-holder">
          <div class="showcase-item-preview ${specialClass}" style="border-color: ${borderColor};">
            <img src="${safeIconUrl}" alt="${item.name.replace(/"/g, '&quot;')}" />
            ${item.tradeProtected ? '<div class="provisional_item_badge"></div>' : ''}
            ${isSpecial ? '<div class="special-charm-star">⭐</div>' : ''}
            <div class="charm-overlay ${item.tradeProtected ? 'trade-protected' : ''}">${item.charmValue}</div>
          </div>
        </div>
      `;
    });

    const showcaseHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Charm Showcase</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            background: #1a1a1a;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 20px;
            overflow-y: auto;
          }
          .showcase-header {
            color: #ffffff;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #4a90e2;
          }
          .showcase-header h1 {
            font-size: 24px;
            margin-bottom: 10px;
          }
          .showcase-stats {
            display: flex;
            gap: 20px;
            font-size: 14px;
            color: #b0b0b0;
          }
          .showcase-grid-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 15px;
            padding: 10px 0;
          }
          .showcase-item-holder {
            position: relative;
            width: 100%;
            aspect-ratio: 1;
          }
          .showcase-item-preview {
            position: relative;
            width: 100%;
            height: 100%;
            background: #2a2a2a;
            border: 2px solid rgb(210, 210, 210);
            border-radius: 4px;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.2s;
          }
          .showcase-item-preview:hover {
            border-color: #4a90e2;
            box-shadow: 0 0 12px rgba(74, 144, 226, 0.5);
            transform: scale(1.05);
            z-index: 5;
          }
          .showcase-item-preview img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            background: #1a1a1a;
          }
          .showcase-item-preview .charm-overlay {
            position: absolute;
            top: 4px;
            right: 4px;
            background: linear-gradient(135deg, #666666 0%, #555555 100%);
            color: #ffffff;
            font-weight: bold;
            font-size: 12px;
            padding: 4px 6px;
            border-radius: 3px;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
            z-index: 10;
            pointer-events: none;
            border: 1px solid rgba(255, 255, 255, 0.2);
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
            font-family: 'Segoe UI', sans-serif;
            line-height: 1.2;
          }
          .showcase-item-preview .charm-overlay.trade-protected {
            background: linear-gradient(135deg, #e2774a 0%, #bd5735 100%);
            border: 1px solid rgba(255, 140, 0, 0.4);
          }
          .showcase-item-preview .provisional_item_badge {
            position: absolute;
            bottom: 4px;
            left: 4px;
            width: 20px;
            height: 20px;
            background: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTggMUw0IDNIMlY4TDggMTJMMTQgOFYzSDEyTDggMVoiIGZpbGw9IiNGRkQ3MDAiLz48cGF0aCBkPSJNOCA0TDYgNUg0VjdMOCA5TDEyIDdWNUgxMEw4IDRaIiBmaWxsPSIjRkZGRkZGIi8+PC9zdmc+') no-repeat center;
            background-size: contain;
            z-index: 10;
            pointer-events: none;
          }
          .showcase-item-preview .special-charm-star {
            position: absolute;
            bottom: 4px;
            right: 4px;
            font-size: 16px;
            z-index: 10;
            pointer-events: none;
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
            line-height: 1;
          }
          .showcase-item-preview.special-charm-item {
            border: 2px solid rgb(255, 215, 0) !important;
            box-shadow: 0 0 10px rgba(255, 215, 0, 0.4) !important;
          }
        </style>
      </head>
      <body>
        <div class="showcase-header">
          <h1>Charm Showcase</h1>
          <div class="showcase-stats">
            <span>Total: ${charms.length}</span>
            <span>Tradable: ${tradableCount}</span>
            <span>Locked: ${lockedCount}</span>
            <span>Special: ${specialCount}</span>
          </div>
        </div>
        <div class="showcase-grid-container">
          ${gridHTML}
        </div>
      </body>
      </html>
    `;

    // Open new window
    const showcaseWindow = window.open('', '_blank', 'width=1200,height=800,resizable=yes,scrollbars=yes');
    if (showcaseWindow) {
      showcaseWindow.document.write(showcaseHTML);
      showcaseWindow.document.close();
    } else {
      alert('Please allow popups to open the showcase window.');
    }
  }

  // Function to export charm list to text file
  function exportCharmList(sortedCharms, tradableCount, tradeProtectedCount) {
    // Get current date and time for filename
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const filename = `charm_list_${dateStr}_${timeStr}.txt`;
    
    // Build the text content
    let textContent = '='.repeat(60) + '\n';
    textContent += 'CS2 CHARM TEMPLATES LIST\n';
    textContent += '='.repeat(60) + '\n\n';
    
    textContent += `Total Charms: ${sortedCharms.length}\n`;
    textContent += `Tradable: ${tradableCount}\n`;
    textContent += `Trade Protected: ${tradeProtectedCount}\n`;
    textContent += `Generated: ${now.toLocaleString()}\n\n`;
    
    textContent += '='.repeat(60) + '\n';
    
    // Add each charm to the list
    sortedCharms.forEach((item, index) => {
      const lockStatus = item.tradeProtected ? ' [LOCKED]' : '';
      textContent += `${item.charmValue.toString().padStart(10, ' ')} | `;
      textContent += `${item.name}${lockStatus}\n`;
    });
        
    // Create a blob and download
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    
    // Clean up
    URL.revokeObjectURL(url);
    
    console.log('Exported charm list to:', filename);
  }

  function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = (element.offsetTop - pos2) + "px";
      element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  // Add charm template overlays to inventory items
  function addCharmOverlays() {
    console.log('Adding charm overlays to inventory items...');
    
    // Find all inventory items
    const inventoryItems = document.querySelectorAll('.itemHolder, .item');
    
    inventoryItems.forEach(item => {
      // Get the item's assetid from its id attribute
      const itemId = item.id;
      if (!itemId) return;
      
      // Extract assetid (format: usually contains 730_2_ASSETID or 730_16_ASSETID)
      const match = itemId.match(/730_(\d+)_(\d+)/);
      if (!match) return;
      
      const assetId = match[2];
      const charmData = charmTemplateMap.get(assetId);
      
      if (!charmData) return;
      
      // Check if overlay already exists
      if (item.querySelector('.charm-overlay')) return;
      
      // Create overlay element
      const overlay = document.createElement('div');
      overlay.className = 'charm-overlay';
      if (charmData.tradeProtected) {
        overlay.classList.add('trade-protected');
      }
      overlay.textContent = charmData.value;
      
      // Add special charm styling to the entire item
      if (isSpecialCharm(charmData.value)) {
        item.classList.add('special-charm-item');
        
        // Add star indicator for special charms
        const star = document.createElement('div');
        star.className = 'special-charm-star';
        star.textContent = '⭐';
        item.appendChild(star);
      }
      
      // Append to item
      item.style.position = 'relative';
      item.appendChild(overlay);
      
      console.log('Added charm overlay:', assetId, '->', charmData.value, charmData.tradeProtected ? '[LOCKED]' : '');
    });
  }

  // Track if scanning is complete
  let isScanningComplete = false;

  // Function to update button state
  function updateButtonState() {
    const button = document.getElementById('charm-scan-btn');
    if (!button) return;
    
    // Check if panel is currently open
    const panel = document.getElementById('charm-template-panel');
    const isPanelOpen = panel !== null;
    
    const countBadge = button.querySelector('.charm-count-badge');
    
    if (isScanningComplete && allDisplayedCharms.length > 0) {
      if (countBadge) {
        countBadge.textContent = allDisplayedCharms.length;
        countBadge.style.display = 'flex';
      }
      // Only enable button if panel is not open
      if (!isPanelOpen) {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
      } else {
        // Keep disabled if panel is open
        button.disabled = true;
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
      }
    } else {
      if (countBadge) {
        countBadge.style.display = 'none';
      }
      button.disabled = true;
      button.style.opacity = '0.6';
      button.style.cursor = 'not-allowed';
    }
  }

  // Add a floating button to open charm list
  function createScanButton() {
    const button = document.createElement('button');
    button.id = 'charm-scan-btn';
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      transition: all 0.3s;
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // Create icon image
    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('icon512.png');
    iconImg.alt = 'Open Charm List';
    iconImg.style.cssText = `
      width: 64px;
      height: 64px;
      border-radius: 50%;
      transition: all 0.3s;
      display: block;
    `;
    
    // Create count badge
    const countBadge = document.createElement('div');
    countBadge.className = 'charm-count-badge';
    countBadge.style.cssText = `
      position: absolute;
      bottom: -4px;
      right: -4px;
      background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
      color: white;
      font-size: 12px;
      font-weight: bold;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      font-family: 'Segoe UI', sans-serif;
    `;
    
    button.appendChild(iconImg);
    button.appendChild(countBadge);
    
    button.onmouseenter = () => {
      iconImg.style.transform = 'scale(1.1)';
    };
    
    button.onmouseleave = () => {
      iconImg.style.transform = 'scale(1)';
    };
    
    button.onclick = () => {
      displayCharmTemplates();
    };
    
    document.body.appendChild(button);
  }

  // Function to perform automatic scan
  async function performAutomaticScan() {
    console.log('🔍 Starting automatic charm scan...');
    console.log('Current URL:', window.location.href);
    console.log('Pathname:', window.location.pathname);
    console.log('Is on inventory page:', isOnInventoryPage());
    
    // Get the actual numeric Steam ID from the page
    let steamId = null;
    let appId = '730'; // Default to CS2
    
    // Use the same detection logic as detectCurrentSteamId()
    
    // FIRST: Try to extract from URL (this tells us whose inventory we're viewing)
    const urlMatch = window.location.pathname.match(/\/profiles\/(\d+)/);
    if (urlMatch) {
      steamId = urlMatch[1];
      console.log('Found Steam ID from profiles URL:', steamId);
    }
    
    // Direct inventory URL pattern
    if (!steamId) {
      const directMatch = window.location.pathname.match(/\/inventory\/(\d+)/);
      if (directMatch) {
        steamId = directMatch[1];
        console.log('Found Steam ID from direct inventory URL:', steamId);
      }
    }
    
    // Try vanity URL pattern
    if (!steamId) {
      const vanityMatch = window.location.pathname.match(/\/id\/([^\/]+)/);
      if (vanityMatch) {
        console.log('Detected vanity URL:', vanityMatch[1]);
        // For vanity URLs, we need to get the numeric ID from page variables
        // Try UserYou object (set via UserYou.SetSteamId)
        if (typeof UserYou !== 'undefined' && UserYou.strSteamId) {
          steamId = UserYou.strSteamId;
          console.log('Found Steam ID from UserYou.strSteamId:', steamId);
        }
        // Try g_rgProfileData which contains the profile being viewed
        else if (typeof g_rgProfileData !== 'undefined' && g_rgProfileData.steamid) {
          steamId = g_rgProfileData.steamid;
          console.log('Found Steam ID from g_rgProfileData.steamid:', steamId);
        }
        // Parse the page HTML for UserYou.SetSteamId call
        else {
          const scriptMatch = document.documentElement.innerHTML.match(/UserYou\.SetSteamId\(\s*['"](\d+)['"]\s*\)/);
          if (scriptMatch) {
            steamId = scriptMatch[1];
            console.log('Found Steam ID from HTML script match:', steamId);
          }
        }
      }
    }
    
    // Last resort fallback: Try g_steamID (but this might be the logged-in user, not the profile being viewed)
    if (!steamId && typeof g_steamID !== 'undefined') {
      steamId = g_steamID;
      console.log('Found Steam ID from g_steamID fallback:', steamId);
    }
    
    // Use currentSteamId if we still don't have one (it was detected earlier)
    if (!steamId && currentSteamId) {
      steamId = currentSteamId;
      console.log('Using currentSteamId:', steamId);
    }
    
    // Get app ID from URL if present
    const appIdMatch = window.location.pathname.match(/\/(\d+)\/\d+/);
    if (appIdMatch && appIdMatch[1]) {
      appId = appIdMatch[1];
    }
    
    if (!steamId) {
      console.log('❌ Could not detect Steam ID for automatic scan');
      console.log('Available globals: UserYou:', typeof UserYou, 'g_rgProfileData:', typeof g_rgProfileData, 'g_steamID:', typeof g_steamID);
      return;
    }
    
    console.log('✅ Scanning inventory for Steam ID:', steamId, 'App ID:', appId, 'URL:', window.location.pathname);
    
     // Fetch both tradable (context 2) and trade-protected (context 16) inventories
     // Note: Using count=75 because Steam API doesn't return asset_properties with larger counts
     const contexts = [
       { context: '2', isTradeProtected: false, name: 'tradable' },
       { context: '16', isTradeProtected: true, name: 'trade-protected' }
     ];
    
    for (const { context, isTradeProtected, name } of contexts) {
      try {
        let lastAssetId = null;
        let hasMoreItems = true;
        let pageCount = 0;
        
        while (hasMoreItems && pageCount < 100) { // Safety limit of 100 pages
          pageCount++;
          
          // Build URL with pagination
          let url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${context}?l=english&count=200`;
          if (lastAssetId) {
            url += `&start_assetid=${lastAssetId}`;
          }
          
          console.log(`Fetching ${name} inventory (page ${pageCount}):`, url);
          
          try {
            const response = await fetch(url);
            
            if (!response.ok) {
              console.log(`Failed to fetch ${name} inventory: HTTP ${response.status}`);
              hasMoreItems = false;
              continue;
            }
            
            let data;
            try {
              data = await response.json();
            } catch (jsonError) {
              console.log(`Failed to parse ${name} inventory JSON:`, jsonError);
              hasMoreItems = false;
              continue;
            }
            
            if (data && data.success === 1) {
              // Process this batch if it has assets
              if (data.assets && data.assets.length > 0) {
                processInventoryData(data, isTradeProtected);
              }
              
              // Check if there are more items to fetch
              if (data.more_items === 1 && data.last_assetid) {
                lastAssetId = data.last_assetid;
                hasMoreItems = true;
              } else {
                hasMoreItems = false;
              }
            } else {
              console.log(`${name} inventory returned success=${data ? data.success : 'undefined'}, error:`, data ? data.error : 'no error');
              hasMoreItems = false;
            }
          } catch (fetchError) {
            console.log(`Error in fetch request for ${name} inventory:`, fetchError);
            hasMoreItems = false;
          }
          
          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        
        console.log(`Completed fetching ${name} inventory (${pageCount} pages)`);
      } catch (e) {
        console.log('Error in inventory scan loop:', e);
      }
    }
    
    console.log('✅ Automatic charm scan complete! Total charms found:', allDisplayedCharms.length);
    isScanningComplete = true;
    updateButtonState();
  }

  // Wait for body to be available and perform automatic scan
  function initButton() {
    if (document.body) {
      createScanButton();
      
      // Automatically scan when on an inventory page
      if (isOnInventoryPage()) {
        // Wait a bit for page elements to load
        setTimeout(() => {
          performAutomaticScan();
        }, 2000);
      }
    } else {
      setTimeout(initButton, 100);
    }
  }
  
  initButton();

  // Monitor item preview tabs and inject charm templates
  function setupItemPreviewMonitoring() {
    // Function to update charm template in preview
    function updateCharmInPreview(itemInfoId) {
      const itemInfo = document.getElementById(itemInfoId);
      if (!itemInfo) return;

      // Find the assetid from the item preview
      // Steam stores it in various places, let's try multiple approaches
      let assetId = null;
      
      // Try to find it in the item actions area (common location)
      const itemActions = itemInfo.querySelector('.item_actions');
      if (itemActions) {
        // Look for any element with data-assetid or id containing the assetid
        const assetElements = itemActions.querySelectorAll('[id*="730_2_"]');
        if (assetElements.length > 0) {
          const match = assetElements[0].id.match(/730_2_(\d+)/);
          if (match) assetId = match[1];
        }
      }

      // Alternative: check the item info div itself
      if (!assetId) {
        const itemTagsContainer = itemInfo.querySelector('.item_desc_descriptors');
        if (itemTagsContainer) {
          const allElements = itemInfo.querySelectorAll('[id*="730_2_"]');
          for (const el of allElements) {
            const match = el.id.match(/730_2_(\d+)/);
            if (match) {
              assetId = match[1];
              break;
            }
          }
        }
      }

      // Alternative: check for item_market_actions links which contain assetid
      if (!assetId) {
        const marketActions = itemInfo.querySelector('.item_market_actions a');
        if (marketActions && marketActions.href) {
          const match = marketActions.href.match(/730_2_(\d+)/);
          if (match) assetId = match[1];
        }
      }

      if (!assetId) return;

      // Check if we have charm data for this asset
      const charmData = charmTemplateMap.get(assetId);
      if (!charmData) return;

      // Find the keychain descriptor and update it
      const keychainDescriptor = itemInfo.querySelector('.item_owner_descriptors .descriptor.keychain');
      if (keychainDescriptor) {
        const valueSpan = keychainDescriptor.querySelector('.value');
        if (valueSpan) {
          const charmVal = parseInt(charmData.value);
          const specialCharmStar = isSpecialCharm(charmVal) ? ' ⭐' : '';
          valueSpan.textContent = charmData.value + specialCharmStar;
          keychainDescriptor.style.display = '';
          console.log('Updated charm template in preview:', assetId, '->', charmData.value, 'Special:', isSpecialCharm(charmVal));
        }
      }
    }

    // Monitor both iteminfo0 and iteminfo1 (Steam uses two panels)
    function observeItemInfo(itemInfoId) {
      const targetNode = document.getElementById(itemInfoId);
      if (!targetNode) {
        // Retry after a delay if not found yet
        setTimeout(() => observeItemInfo(itemInfoId), 1000);
        return;
      }

      // Update immediately if already loaded
      updateCharmInPreview(itemInfoId);

      // Create observer to watch for changes
      const observer = new MutationObserver(() => {
        updateCharmInPreview(itemInfoId);
      });

      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }

    // Start observing when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        observeItemInfo('iteminfo0');
        observeItemInfo('iteminfo1');
      });
    } else {
      observeItemInfo('iteminfo0');
      observeItemInfo('iteminfo1');
    }
  }

  setupItemPreviewMonitoring();

  // Monitor inventory for new items being loaded
  function setupInventoryMonitoring() {
    const inventoryContainer = document.getElementById('inventories');
    if (!inventoryContainer) {
      setTimeout(setupInventoryMonitoring, 1000);
      return;
    }

    // Initial overlay addition
    addCharmOverlays();

    // Watch for inventory changes (pagination, filtering, etc)
    const observer = new MutationObserver(() => {
      addCharmOverlays();
    });

    observer.observe(inventoryContainer, {
      childList: true,
      subtree: true
    });
  }

  setupInventoryMonitoring();

  // Monitor URL changes to detect inventory switches
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      checkInventoryChange();
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Also check periodically
  setInterval(checkInventoryChange, 2000);
})();

