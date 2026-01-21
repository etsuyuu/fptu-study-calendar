// Timing constants to replace magic numbers
const WAIT_TIMES = {
  DEFAULT_WAIT_TIME: 3000,           // Default wait time for page operations (ms)
  SCRAPING_TIMEOUT: 30000,           // Timeout for scraping operation (ms)
  PROGRESS_RESET_DELAY: 3000         // Delay before resetting progress message (ms)
};

// Internationalization helper
function getMessage(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions);
}

// Format date to DD/MM/YYYY for display
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Get end of year date
function getEndOfYear(year) {
  return new Date(year, 11, 31); // December 31
}

// Comprehensive date range validation
function validateDateRange(startDate, endDate) {
  // Check if dates are empty
  if (!startDate || !endDate) {
    return { valid: false, error: getMessage('errorDateRangeEmpty') };
  }
  
  // Parse dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Check if dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: getMessage('errorDateRangeInvalid') };
  }
  
  // Check if start date is after end date
  if (start > end) {
    return { valid: false, error: getMessage('errorStartAfterEnd') };
  }
  
  // Check if date range is too large (more than 1 year)
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  if (daysDiff > 365) {
    return { valid: false, error: getMessage('errorDateRangeTooLarge') };
  }
  
  // Check if date range is too small (less than 1 day)
  if (daysDiff < 1) {
    return { valid: false, error: getMessage('errorDateRangeTooSmall') };
  }
  
  // All validations passed
  return { valid: true };
}

// Show merge/replace dialog and return user choice
function showMergeReplaceDialog(modesDiffer = false) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('mergeReplaceOverlay');
    const mergeButton = document.getElementById('mergeButton');
    const replaceButton = document.getElementById('replaceButton');
    const cancelButton = document.getElementById('cancelMergeReplaceButton');
    const closeButton = document.getElementById('mergeReplaceOverlayClose');
    const modeWarning = document.getElementById('modeDifferenceWarning');
    
    // Show/hide mode difference warning
    if (modeWarning) {
      modeWarning.style.display = modesDiffer ? 'block' : 'none';
    }
    
    // Show overlay
    overlay.classList.add('active');
    
    // Handle button clicks
    const handleChoice = (choice) => {
      overlay.classList.remove('active');
      resolve(choice);
    };
    
    mergeButton.addEventListener('click', () => handleChoice('merge'), { once: true });
    replaceButton.addEventListener('click', () => handleChoice('replace'), { once: true });
    cancelButton.addEventListener('click', () => handleChoice(null), { once: true });
    closeButton.addEventListener('click', () => handleChoice(null), { once: true });
    
    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        handleChoice(null);
      }
    }, { once: true });
  });
}

// Show fast mode error overlay
function showFastModeErrorOverlay(errorCode) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('fastModeErrorOverlay');
    const errorMessage = document.getElementById('fastModeErrorMessage');
    const retryDetailedBtn = document.getElementById('retryDetailedModeBtn');
    const dismissBtn = document.getElementById('dismissErrorBtn');
    const closeButton = document.getElementById('fastModeErrorClose');
    
    // Set error message based on error code
    const errorMessages = {
      'NO_COURSES': getMessage('errorNoCoursesFound'),
      'ATTENDANCE_UNAVAILABLE': getMessage('errorAttendanceUnavailable'),
      'TIMEOUT': getMessage('errorTimeout'),
      'UNKNOWN': getMessage('errorUnknown')
    };
    
    errorMessage.textContent = errorMessages[errorCode] || errorMessages['UNKNOWN'];
    
    // Show overlay
    overlay.classList.add('active');
    
    // Handle button clicks
    const handleChoice = (choice) => {
      overlay.classList.remove('active');
      resolve(choice);
    };
    
    retryDetailedBtn.addEventListener('click', () => handleChoice('retry-detailed'), { once: true });
    dismissBtn.addEventListener('click', () => handleChoice('dismiss'), { once: true });
    closeButton.addEventListener('click', () => handleChoice('dismiss'), { once: true });
    
    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        handleChoice('dismiss');
      }
    }, { once: true });
  });
}

// Theme management
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const systemTheme = getSystemTheme();
    root.setAttribute('data-theme', systemTheme);
  } else {
    root.setAttribute('data-theme', theme);
  }
}

async function loadTheme() {
  const result = await chrome.storage.local.get(['theme']);
  const theme = result.theme || 'system';
  applyTheme(theme);
  return theme;
}

async function saveTheme(theme) {
  await chrome.storage.local.set({ theme });
  applyTheme(theme);
  // Notify other extension pages of theme change
  chrome.runtime.sendMessage({ action: 'themeChanged', theme }).catch(() => {
    // Ignore errors if no listeners
  });
}

// Calculate end date (3 months after start, ending at the last day of the month)
function calculateEndDate(startDate) {
  const start = new Date(startDate);
  const year = start.getFullYear();
  
  // Add 3 months
  const endDate = new Date(start);
  endDate.setMonth(endDate.getMonth() + 3);
  
  // Set to the last day of that month
  endDate.setMonth(endDate.getMonth() + 1, 0); // Day 0 = last day of previous month
  
  // Restrict to end of year
  const yearEnd = getEndOfYear(year);
  return endDate > yearEnd ? yearEnd : endDate;
}

// Initialize popup
async function initPopup() {
  // Set i18n text
  document.getElementById('extensionName').textContent = getMessage('extensionName');
  document.getElementById('headerSubtitle').textContent = getMessage('popupSubtitle');
  document.getElementById('startDateLabel').textContent = getMessage('startDateLabel');
  document.getElementById('endDateLabel').textContent = getMessage('endDateLabel');
  document.getElementById('waitTimeLabel').textContent = getMessage('waitTimeLabel');
  document.getElementById('advancedSettingsText').textContent = getMessage('advancedSettings');
  document.getElementById('aboutTitle').textContent = getMessage('aboutTitle');
  document.getElementById('aboutVersionLabel').textContent = getMessage('aboutVersionLabel');
  document.getElementById('aboutAuthorLabel').textContent = getMessage('aboutAuthorLabel');
  document.getElementById('aboutGitHubLabel').textContent = getMessage('aboutGitHubLabel');
  document.getElementById('aboutHelpLabel').textContent = getMessage('aboutHelpLabel');
  // GitHub link is set in HTML, no need to set textContent
  document.getElementById('themeLabel').textContent = getMessage('themeLabel');
  
  // Initialize donation text if element exists
  const donationText = document.querySelector('.donation-text');
  if (donationText) {
    donationText.textContent = getMessage('donationAppreciated');
  }
  document.getElementById('themeSystemOption').textContent = getMessage('themeSystem');
  document.getElementById('themeLightOption').textContent = getMessage('themeLight');
  document.getElementById('themeDarkOption').textContent = getMessage('themeDark');
  document.getElementById('scrapeButtonText').textContent = getMessage('scrapeButton');
  document.getElementById('previewButtonText').textContent = getMessage('previewButton');
  document.getElementById('exportButtonText').textContent = getMessage('exportButton');
  document.getElementById('progress').textContent = getMessage('progressDefault');
  
  // Initialize mode selector i18n
  const scrapeModeLabel = document.querySelector('[data-i18n="scrapeModeLabel"]');
  if (scrapeModeLabel) scrapeModeLabel.textContent = getMessage('scrapeModeLabel');
  
  const fastModeLabel = document.querySelector('[data-i18n="fastModeLabel"]');
  if (fastModeLabel) fastModeLabel.textContent = getMessage('fastModeLabel');
  
  const modeBadgeFast = document.querySelector('[data-i18n="modeBadgeFast"]');
  if (modeBadgeFast) modeBadgeFast.textContent = getMessage('modeBadgeFast');
  
  const fastModeDesc = document.querySelector('[data-i18n="fastModeDesc"]');
  if (fastModeDesc) fastModeDesc.textContent = getMessage('fastModeDesc');
  
  const detailedModeLabel = document.querySelector('[data-i18n="detailedModeLabel"]');
  if (detailedModeLabel) detailedModeLabel.textContent = getMessage('detailedModeLabel');
  
  const detailedModeDesc = document.querySelector('[data-i18n="detailedModeDesc"]');
  if (detailedModeDesc) detailedModeDesc.textContent = getMessage('detailedModeDesc');
  
  const semesterLabel = document.querySelector('[data-i18n="semesterLabel"]');
  if (semesterLabel) semesterLabel.textContent = getMessage('semesterLabel');
  
  const refreshCacheTooltip = document.getElementById('refreshCacheBtn');
  if (refreshCacheTooltip) refreshCacheTooltip.title = getMessage('refreshCacheTooltip');
  
  // Set page title
  document.title = getMessage('popupTitle');
  
  // Initialize footer
  document.getElementById('footerMadeBy').textContent = getMessage('footerMadeBy');
  const footerHelpLink = document.getElementById('footerHelpLink');
  footerHelpLink.textContent = getMessage('footerHelpLink');
  
  // Initialize help overlay
  const helpOverlay = document.getElementById('helpOverlay');
  const helpOverlayClose = document.getElementById('helpOverlayClose');
  
  // Set help content localization
  document.getElementById('helpTitle').textContent = getMessage('helpTitle');
  document.getElementById('helpTipsNotice').textContent = getMessage('helpTipsNotice');
  document.getElementById('helpSectionGettingStarted').textContent = getMessage('helpSectionGettingStarted');
  document.getElementById('helpStep1').textContent = getMessage('helpStep1');
  document.getElementById('helpStep2').textContent = getMessage('helpStep2');
  document.getElementById('helpStep3').textContent = getMessage('helpStep3');
  document.getElementById('helpStep4').textContent = getMessage('helpStep4');
  document.getElementById('helpSectionFeatures').textContent = getMessage('helpSectionFeatures');
  // Use innerHTML for items with HTML formatting
  document.getElementById('helpFeature1').innerHTML = getMessage('helpFeature1');
  document.getElementById('helpFeature2').innerHTML = getMessage('helpFeature2');
  document.getElementById('helpFeature3').innerHTML = getMessage('helpFeature3');
  document.getElementById('helpSectionModes').textContent = getMessage('helpSectionModes');
  document.getElementById('helpModeFastTitle').innerHTML = getMessage('helpModeFastTitle');
  document.getElementById('helpModeFastDescription').textContent = getMessage('helpModeFastDescription');
  document.getElementById('helpModeFastUses').textContent = getMessage('helpModeFastUses');
  document.getElementById('helpModeDetailedTitle').innerHTML = getMessage('helpModeDetailedTitle');
  document.getElementById('helpModeDetailedDescription').textContent = getMessage('helpModeDetailedDescription');
  document.getElementById('helpModeDetailedUses').textContent = getMessage('helpModeDetailedUses');
  document.getElementById('helpSectionTips').textContent = getMessage('helpSectionTips');
  document.getElementById('helpTip1').textContent = getMessage('helpTip1');
  document.getElementById('helpTip2').textContent = getMessage('helpTip2');
  document.getElementById('helpTip3').textContent = getMessage('helpTip3');
  document.getElementById('helpTip4').textContent = getMessage('helpTip4');
  document.getElementById('helpTip5').innerHTML = getMessage('helpTip5');
  document.getElementById('helpSectionTroubleshooting').textContent = getMessage('helpSectionTroubleshooting');
  // Use innerHTML for items with HTML formatting
  document.getElementById('helpTrouble1').innerHTML = getMessage('helpTrouble1');
  document.getElementById('helpTrouble2').innerHTML = getMessage('helpTrouble2');
  document.getElementById('helpTrouble3').innerHTML = getMessage('helpTrouble3');
  document.getElementById('helpTrouble4').innerHTML = getMessage('helpTrouble4');
  document.getElementById('helpSectionSupport').textContent = getMessage('helpSectionSupport');
  document.getElementById('helpSupportMessage').textContent = getMessage('helpSupportMessage');
  document.getElementById('helpSupportGitHub').textContent = getMessage('helpSupportGitHub');
  document.getElementById('helpSupportEmail').textContent = getMessage('helpSupportEmail');
  
  // Footer help link click handler
  footerHelpLink.addEventListener('click', (e) => {
    e.preventDefault();
    helpOverlay.classList.add('active');
  });
  
  helpOverlayClose.addEventListener('click', () => {
    helpOverlay.classList.remove('active');
  });
  
  // Close help overlay when clicking outside
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) {
      helpOverlay.classList.remove('active');
    }
  });
  
  // Initialize settings overlay
  const settingsButton = document.getElementById('settingsButton');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const overlayClose = document.getElementById('overlayClose');
  
  settingsButton.addEventListener('click', () => {
    settingsOverlay.classList.add('active');
  });
  
  // Function to close settings overlay (with validation)
  function closeSettingsOverlay() {
    // Validate wait time before closing
    if (!isWaitTimeValid()) {
      // Show error and prevent closing
      validateWaitTime(waitTimeInput.value, true);
      alert(getMessage('errorWaitTimeInvalid'));
      return false;
    }
    settingsOverlay.classList.remove('active');
    return true;
  }
  
  overlayClose.addEventListener('click', () => {
    closeSettingsOverlay();
  });
  
  // Close overlay when clicking outside
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      closeSettingsOverlay();
    }
  });
  
  // Close overlay with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (helpOverlay.classList.contains('active')) {
        helpOverlay.classList.remove('active');
      } else if (settingsOverlay.classList.contains('active')) {
        closeSettingsOverlay();
      }
    }
  });

  // Initialize theme
  const savedTheme = await loadTheme();
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.value = savedTheme;
    themeSelect.addEventListener('change', async (e) => {
      await saveTheme(e.target.value);
    });
  }

  // Listen for system theme changes when system theme is selected
  if (savedTheme === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          let errorMsg = response.errorMessage || response.error || getMessage('errorUnknown');
    });
  }

  // Load saved settings
  const result = await chrome.storage.local.get(['waitTime', 'startDate', 'endDate']);
  let waitTime = result.waitTime || WAIT_TIMES.DEFAULT_WAIT_TIME;
  
  // Validate and clamp saved wait time if invalid
  if (waitTime < 1000) {
    waitTime = 1000;
    chrome.storage.local.set({ waitTime: 1000 });
  } else if (waitTime > 10000) {
    waitTime = 10000;
    chrome.storage.local.set({ waitTime: 10000 });
  }
  
  document.getElementById('waitTime').value = waitTime;

  // Load saved dates or use defaults
  const today = new Date();
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  
  if (result.startDate && result.endDate) {
    // Use saved dates
    startDateInput.value = result.startDate;
    endDateInput.value = result.endDate;
    
    // Set max date for end date based on start date year
    const startYear = new Date(result.startDate).getFullYear();
    endDateInput.max = getEndOfYear(startYear).toISOString().split('T')[0];
  } else {
    // Set start date to today
    startDateInput.value = today.toISOString().split('T')[0];
    
    // Calculate and set end date
    const endDate = calculateEndDate(today);
    endDateInput.value = endDate.toISOString().split('T')[0];
  }

  // Save dates when they change
  startDateInput.addEventListener('change', () => {
    const newStart = new Date(startDateInput.value);
    const newEnd = calculateEndDate(newStart);
    endDateInput.value = newEnd.toISOString().split('T')[0];
    
    // Update max date to end of year
    const year = newStart.getFullYear();
    endDateInput.max = getEndOfYear(year).toISOString().split('T')[0];
    
    // Save to storage
    chrome.storage.local.set({
      startDate: startDateInput.value,
      endDate: endDateInput.value
    });
  });

  endDateInput.addEventListener('change', () => {
    // Save to storage
    chrome.storage.local.set({
      startDate: startDateInput.value,
      endDate: endDateInput.value
    });
  });

  // Wait time validation and save
  const waitTimeInput = document.getElementById('waitTime');
  const waitTimeError = document.getElementById('waitTimeError');
  
  // Validation function - accessible globally for overlay close and scrape checks
  function validateWaitTime(value, showError = true) {
    const numValue = parseInt(value, 10);
    
    // Clear previous error
    if (showError) {
      waitTimeInput.classList.remove('invalid');
      waitTimeError.style.display = 'none';
      waitTimeError.textContent = '';
    }
    
    // Check if empty
    if (value === '' || isNaN(numValue)) {
      if (showError) {
        waitTimeInput.classList.add('invalid');
        waitTimeError.textContent = getMessage('errorWaitTimeRequired');
        waitTimeError.style.display = 'block';
      }
      return false;
    }
    
    // Check if below minimum
    if (numValue < 1000) {
      if (showError) {
        waitTimeInput.classList.add('invalid');
        waitTimeError.textContent = getMessage('errorWaitTimeMin');
        waitTimeError.style.display = 'block';
      }
      return false;
    }
    
    // Check if above maximum
    if (numValue > 10000) {
      if (showError) {
        waitTimeInput.classList.add('invalid');
        waitTimeError.textContent = getMessage('errorWaitTimeMax');
        waitTimeError.style.display = 'block';
      }
      return false;
    }
    
    return true;
  }
  
  // Function to check if wait time is valid (for overlay close and scrape validation)
  function isWaitTimeValid() {
    const value = waitTimeInput.value;
    return validateWaitTime(value, false);
  }
  
  // Validate on input (real-time feedback)
  waitTimeInput.addEventListener('input', (e) => {
    const value = e.target.value;
    if (value !== '') {
      validateWaitTime(value);
    } else {
      // Clear error when field is empty (user is typing)
      waitTimeInput.classList.remove('invalid');
      waitTimeError.style.display = 'none';
    }
  });
  
  // Validate and save on change
  waitTimeInput.addEventListener('change', (e) => {
    const value = e.target.value;
    if (validateWaitTime(value)) {
      const numValue = parseInt(value, 10);
      chrome.storage.local.set({ waitTime: numValue });
    }
  });

  // Get button references early so they're available in all handlers
  const scrapeButton = document.getElementById('scrapeButton');
  const previewButton = document.getElementById('previewButton');
  const exportButton = document.getElementById('exportButton');
  const progress = document.getElementById('progress');

  // Mode management
  const fastModeRadio = document.getElementById('fastModeRadio');
  const detailedModeRadio = document.getElementById('detailedModeRadio');
  const fastModeContainer = document.getElementById('fastModeContainer');
  const detailedModeContainer = document.getElementById('detailedModeContainer');
  const semesterSelect = document.getElementById('semesterSelect');
  const refreshCacheBtn = document.getElementById('refreshCacheBtn');
  
  // Load saved mode preference (default to 'detailed')
  const modeResult = await chrome.storage.local.get(['scrapeMode']);
  const savedMode = modeResult.scrapeMode || 'detailed';
  
  // Function to toggle mode containers
  function toggleModeContainers(mode) {
    if (mode === 'fast') {
      fastModeContainer.style.display = 'block';
      detailedModeContainer.style.display = 'none';
      fastModeRadio.checked = true;
    } else {
      fastModeContainer.style.display = 'none';
      detailedModeContainer.style.display = 'block';
      detailedModeRadio.checked = true;
    }
  }
  
  // Function to load semesters into dropdown
  async function loadSemesters(forceRefresh = false) {
    semesterSelect.disabled = true;
    semesterSelect.innerHTML = `<option value="">${getMessage('loadingSemesters')}</option>`;
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getSemestersList',
        forceRefresh
      });
      
      if (response.success && response.semesters && response.semesters.length > 0) {
        semesterSelect.innerHTML = '';
        response.semesters.forEach(semester => {
          const option = document.createElement('option');
          option.value = semester.id;
          option.textContent = semester.name;
          if (semester.isLatest) {
            option.selected = true;
          }
          semesterSelect.appendChild(option);
        });
        
        // Load saved semester selection if exists
        const semesterResult = await chrome.storage.local.get(['selectedSemester']);
        if (semesterResult.selectedSemester && !forceRefresh) {
          semesterSelect.value = semesterResult.selectedSemester;
        }
      } else {
        semesterSelect.innerHTML = `<option value="">${response.error || getMessage('errorLoadingSemesters')}</option>`;
      }
    } catch (error) {
      console.error('Error loading semesters:', error);
      semesterSelect.innerHTML = `<option value="">${getMessage('errorLoadingSemesters')}</option>`;
    } finally {
      semesterSelect.disabled = false;
    }
  }
  
  // Initialize mode UI
  toggleModeContainers(savedMode);
  
  // Load semesters if fast mode is selected
  if (savedMode === 'fast') {
    loadSemesters();
  }
  
  // Mode radio change handlers
  fastModeRadio.addEventListener('change', () => {
    if (fastModeRadio.checked) {
      toggleModeContainers('fast');
      chrome.storage.local.set({ scrapeMode: 'fast' });
      loadSemesters();
    }
  });
  
  detailedModeRadio.addEventListener('change', () => {
    if (detailedModeRadio.checked) {
      toggleModeContainers('detailed');
      chrome.storage.local.set({ scrapeMode: 'detailed' });
    }
  });
  
  // Semester select change handler
  semesterSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedSemester: semesterSelect.value });
  });
  
  // Refresh cache button handler
  refreshCacheBtn.addEventListener('click', async () => {
    refreshCacheBtn.disabled = true;
    await chrome.runtime.sendMessage({ action: 'invalidateCache' });
    await loadSemesters(true);
    refreshCacheBtn.disabled = false;
  });

  // Scrape button handler
  scrapeButton.addEventListener('click', async () => {
    // Validate wait time before scraping
    if (!isWaitTimeValid()) {
      // Open settings overlay to show the error
      settingsOverlay.classList.add('active');
      validateWaitTime(waitTimeInput.value, true);
      alert(getMessage('errorWaitTimeInvalid'));
      return;
    }
    
    // Get current mode
    const currentMode = fastModeRadio.checked ? 'fast' : 'detailed';
    let messagePayload;
    
    // Mode-specific validation and message preparation
    if (currentMode === 'fast') {
      // Fast mode: validate semester selection
      const selectedSemester = semesterSelect.value;
      if (!selectedSemester) {
        alert(getMessage('errorNoSemesterSelected'));
        return;
      }
      
      messagePayload = {
        action: 'startScraping',
        mode: 'fast',
        semesterId: selectedSemester,
        waitTime: parseInt(document.getElementById('waitTime').value, 10)
      };
    } else {
      // Detailed mode: validate date range
      const startDate = document.getElementById('startDate').value;
      const endDate = document.getElementById('endDate').value;
      
      const validation = validateDateRange(startDate, endDate);
      if (!validation.valid) {
        alert(validation.error);
        return;
      }
      
      messagePayload = {
        action: 'startScraping',
        mode: 'detailed',
        startDate,
        endDate,
        waitTime: parseInt(document.getElementById('waitTime').value, 10)
      };
    }

    // Check for existing data and determine if modes differ
    const existing = await chrome.storage.local.get(['scrapedClasses', 'lastScrapeMode']);
    let mergeMode = false;
    let modesDiffer = false;
    
    if (existing.scrapedClasses && existing.scrapedClasses.length > 0) {
      // Check if modes differ
      if (existing.lastScrapeMode && existing.lastScrapeMode !== currentMode) {
        modesDiffer = true;
      }
      
      // Show merge/replace dialog with mode difference warning
      const userChoice = await showMergeReplaceDialog(modesDiffer);
      if (userChoice === null) {
        return; // User cancelled
      }
      mergeMode = userChoice === 'merge';
    }
    
    // Add mergeMode to message payload
    messagePayload.mergeMode = mergeMode;

    // Disable button and show progress
    scrapeButton.disabled = true;
    progress.className = 'progress loading';
    progress.textContent = getMessage('progressInitializing');

    try {
      // Send message to background script
      progress.textContent = getMessage('progressSending');
      
      const response = await new Promise((resolve, reject) => {
        // Set timeout
        const timeout = setTimeout(() => {
          reject(new Error(getMessage('errorTimeout')));
        }, WAIT_TIMES.SCRAPING_TIMEOUT);
        
        chrome.runtime.sendMessage(messagePayload, (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            console.error('Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(`Lỗi: ${chrome.runtime.lastError.message}`));
            return;
          }
          
          if (!response) {
            reject(new Error(getMessage('errorNoResponse')));
            return;
          }
          
          console.log('Received response from background:', response);
          resolve(response);
        });
      });

      if (response.success) {
        // Show success message
        progress.className = 'progress success';
        progress.textContent = getMessage('progressSuccess');
        
        // Save last scrape mode
        chrome.storage.local.set({ lastScrapeMode: currentMode });
        
        // Log errors if any
        if (response.errors && response.errors.length > 0) {
          console.log('Các tuần không thể trích xuất:', response.errors);
        }
        
        // Enable export button
        exportButton.disabled = false;
        // Preview button is always enabled
        
        // Reset progress after 5 seconds
        setTimeout(() => {
          progress.className = 'progress';
          progress.textContent = getMessage('progressDefault');
        }, 5000);
      } else {
        // Handle errors
        let errorMsg = response.error || getMessage('errorUnknown');
        
        // Check if it's a fast mode specific error
        if (currentMode === 'fast' && (
          response.error === 'NO_COURSES' ||
          response.error === 'ATTENDANCE_UNAVAILABLE'
        )) {
          // Show fast mode error overlay with retry option
          const choice = await showFastModeErrorOverlay(response.error);
          
          if (choice === 'retry-detailed') {
            // Switch to detailed mode and open date picker
            detailedModeRadio.click();
            // Don't throw error, just reset UI
            progress.className = 'progress';
            progress.textContent = getMessage('progressDefault');
            scrapeButton.disabled = false;
            return;
          }
          // If dismissed, throw error to show in progress
        }
        
        // Map common error codes to localized messages
        if (errorMsg === 'NOT_LOGGED_IN') {
          errorMsg = getMessage('errorNotLoggedIn');
        } else if (errorMsg === 'NAVIGATION_FAILED') {
          errorMsg = getMessage('errorNavigation');
        } else if (errorMsg === 'NO_COURSES') {
          errorMsg = getMessage('errorNoCoursesFound');
        } else if (errorMsg === 'ATTENDANCE_UNAVAILABLE') {
          errorMsg = getMessage('errorAttendanceUnavailable');
        }
        
        throw new Error(errorMsg);
      }
    } catch (error) {
      progress.className = 'progress error';
      progress.textContent = `${getMessage('errorPrefix')} ${error.message}`;
      console.error('Scraping error:', error);
    } finally {
      scrapeButton.disabled = false;
    }
  });

  // Preview button handler
  previewButton.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('calendar.html') });
  });

  // Export button handler
  exportButton.addEventListener('click', async () => {
    try {
      // Get classes from storage
      const result = await chrome.storage.local.get(['scrapedClasses']);
      const classes = result.scrapedClasses || [];
      
      if (classes.length === 0) {
        alert(getMessage('errorNoDataToExport'));
        return;
      }
      
      // Export to ICS
      exportToIcs(classes);
      
      // Show success message
      progress.className = 'progress success';
      progress.textContent = getMessage('exportSuccessMessage', [classes.length.toString()]);
      
      // Reset progress after configured delay
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, WAIT_TIMES.PROGRESS_RESET_DELAY);
    } catch (error) {
      console.error('Export error:', error);
      progress.className = 'progress error';
      progress.textContent = `Lỗi xuất file: ${error.message}`;
      
      // Reset progress after 5 seconds
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, 5000);
    }
  });

  // Check if there's existing scraped data to enable export button
  async function checkExistingData() {
    const result = await chrome.storage.local.get(['scrapedClasses']);
    if (result.scrapedClasses && result.scrapedClasses.length > 0) {
      document.getElementById('exportButton').disabled = false;
    }
  }
  checkExistingData();
  
  // Preview button is always enabled (no need to check for data)
  previewButton.disabled = false;

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'progressUpdate') {
      progress.className = 'progress loading';
      // Check if this is fast mode (currentCourse) or detailed mode (currentWeek)
      if (message.currentCourse !== undefined && message.totalCourses !== undefined) {
        // Fast mode progress
        progress.textContent = getMessage('fastModeProgress', [message.currentCourse.toString(), message.totalCourses.toString()]);
      } else if (message.currentWeek !== undefined && message.totalWeeks !== undefined) {
        // Detailed mode progress
        progress.textContent = getMessage('progressScraping', [message.currentWeek.toString(), message.totalWeeks.toString()]);
      } else {
        progress.textContent = getMessage('progressInitializing');
      }
    } else if (message.action === 'scrapingComplete') {
      // Update progress to show completion with week count
      progress.className = 'progress success';
      if (message.totalWeeks !== undefined && message.successCount !== undefined) {
        progress.textContent = getMessage('progressSuccessWithWeeks', [message.successCount.toString(), message.totalWeeks.toString()]);
      } else {
        progress.textContent = getMessage('progressSuccess');
      }
      
      // Enable export button
      exportButton.disabled = false;
      // Preview button is always enabled
      
      // Reset progress after 5 seconds
      setTimeout(() => {
        progress.className = 'progress';
        progress.textContent = getMessage('progressDefault');
      }, 5000);
      
      console.log('Scraping completed:', message);
    }
    return true;
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}

