// Background service worker for FPTU Study Calendar Exporter

const FAP_BASE_URL = 'https://fap.fpt.edu.vn';
const TIMETABLE_URL = 'https://fap.fpt.edu.vn/Report/ScheduleOfWeek.aspx';
const ATTENDANCE_URL = 'https://fap.fpt.edu.vn/Report/ViewAttendstudent.aspx';
const LOGIN_CHECK_SELECTOR = '#ctl00_divUser';
const MAX_RETRIES = 3;
const LOGIN_CACHE_KEY = 'fptu_calendar_login_state';
const LOGIN_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
const FIRST_RUN_COMPLETED_KEY = 'fptu_calendar_first_run_completed';

// Fast mode cache constants
const CACHE_TTL_MS = 3 * 30 * 24 * 60 * 60 * 1000; // 3 months
const FAST_MODE_CACHE_KEY = 'fastModeCache';
const SCRAPE_MODE_KEY = 'scrapeMode';
const SELECTED_SEMESTER_KEY = 'selectedSemester';

// Timing constants to replace magic numbers
const WAIT_TIMES = {
  PAGE_READY_DELAY: 500,              // Delay after page readyState is complete (ms)
  POLLING_INTERVAL: 100,               // Interval for checking page/table readiness (ms)
  CONTENT_SCRIPT_INIT: 1500,           // Delay for content script initialization (ms)
  OVERLAY_INIT: 100,                   // Delay for overlay initialization (ms)
  DATA_READY_TIMEOUT: 10000,           // Timeout for dataReady message (ms)
  ATTENDANCE_PAGE_READY: 800,          // Delay for attendance page load (ms)
  SEMESTER_SUBJECT_LOAD: 1200,         // Delay for semester/subject page load (ms)
  COURSE_NAVIGATION: 500               // Delay between course navigations (ms)
};

// Log when service worker starts
console.log('FPTU Study Calendar Exporter: Background service worker loaded');

// Get cached login state
async function getCachedLoginState() {
  try {
    const cached = await chrome.storage.local.get(LOGIN_CACHE_KEY);
    if (cached[LOGIN_CACHE_KEY]) {
      const { isLoggedIn, timestamp } = cached[LOGIN_CACHE_KEY];
      const now = Date.now();
      // Check if cache is still valid (within 30 minutes)
      if (now - timestamp < LOGIN_CACHE_DURATION) {
        console.log('Using cached login state:', isLoggedIn);
        return isLoggedIn;
      } else {
        console.log('Login cache expired, will re-check');
      }
    }
    return null; // No valid cache
  } catch (error) {
    console.error('Error getting cached login state:', error);
    return null;
  }
}

// Save login state to cache
async function saveLoginStateToCache(isLoggedIn) {
  try {
    await chrome.storage.local.set({
      [LOGIN_CACHE_KEY]: {
        isLoggedIn,
        timestamp: Date.now()
      }
    });
    console.log('Saved login state to cache:', isLoggedIn);
  } catch (error) {
    console.error('Error saving login state to cache:', error);
  }
}

// Invalidate login cache (e.g., when navigation fails, user might have logged out)
async function invalidateLoginCache() {
  try {
    await chrome.storage.local.remove(LOGIN_CACHE_KEY);
    console.log('Invalidated login cache');
  } catch (error) {
    console.error('Error invalidating login cache:', error);
  }
}

// Check if this is the first run
async function isFirstRun() {
  try {
    const result = await chrome.storage.local.get(FIRST_RUN_COMPLETED_KEY);
    return !result[FIRST_RUN_COMPLETED_KEY];
  } catch (error) {
    console.error('Error checking first run status:', error);
    // On error, assume it's not first run to avoid forcing login check unnecessarily
    return false;
  }
}

// Mark first run as completed
async function markFirstRunCompleted() {
  try {
    await chrome.storage.local.set({ [FIRST_RUN_COMPLETED_KEY]: true });
    console.log('Marked first run as completed');
  } catch (error) {
    console.error('Error marking first run as completed:', error);
  }
}

// Reset first run flag (called on install/reload)
async function resetFirstRunFlag() {
  try {
    await chrome.storage.local.remove(FIRST_RUN_COMPLETED_KEY);
    console.log('Reset first run flag');
  } catch (error) {
    console.error('Error resetting first run flag:', error);
  }
}

// Check if already on timetable page
async function isOnTimetablePage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check if URL matches timetable page and has student info element
        const isCorrectUrl = window.location.href === 'https://fap.fpt.edu.vn/Report/ScheduleOfWeek.aspx';
        const hasStudentInfo = document.querySelector('#ctl00_mainContent_lblStudent') !== null;
        // Also check that we're NOT on login page (in case of redirect)
        const isLoginPage = document.querySelector('#ctl00_mainContent_btnLogin') !== null;
        return isCorrectUrl && hasStudentInfo && !isLoginPage;
      }
    });
    return results[0].result;
  } catch (error) {
    console.error('Error checking if on timetable page:', error);
    return false;
  }
}

// Find existing FAP tab (login page or timetable page)
async function findExistingFAPTab() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://fap.fpt.edu.vn/*'] });
    
    // Look for timetable page first (preferred)
    for (const tab of tabs) {
      if (tab.url && tab.url.includes('ScheduleOfWeek.aspx')) {
        const isOnTimetable = await isOnTimetablePage(tab.id);
        if (isOnTimetable) {
          console.log('Found existing timetable tab:', tab.id);
          return tab;
        }
      }
    }
    
    // Look for any FAP tab (could be login page or other pages)
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith(FAP_BASE_URL)) {
        console.log('Found existing FAP tab:', tab.id, tab.url);
        return tab;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding existing FAP tab:', error);
    return null;
  }
}

// Check if user is logged in (with caching and proper page load waiting)
async function checkLogin(tabId, forceCheck = false) {
  try {
    // Check cache first unless forced
    if (!forceCheck) {
      const cachedState = await getCachedLoginState();
      // Only trust cache if it says true (user is logged in)
      // If cache says false, we must verify because user might have logged in since then
      if (cachedState === true) {
        console.log('Using cached login state (logged in), skipping actual check');
        return cachedState;
      }
      // If cache is null, we need to check
      // If cache is false, we also need to check (user might have logged in)
    }
    
    console.log('Performing actual login check on tab:', tabId);
    
    // Wait for page to fully load and DOM to be ready before checking
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise((resolve) => {
          if (document.readyState === 'complete') {
            // Wait a bit more for any dynamic content
            setTimeout(resolve, WAIT_TIMES.PAGE_READY_DELAY);
          } else {
            const checkReady = () => {
              if (document.readyState === 'complete') {
                setTimeout(resolve, WAIT_TIMES.PAGE_READY_DELAY);
              } else {
                setTimeout(checkReady, WAIT_TIMES.POLLING_INTERVAL);
              }
            };
            checkReady();
          }
        });
      }
    });
    
    // Perform actual login check with retry
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Try to find the login indicator element
        const userDiv = document.querySelector('#ctl00_divUser');
        // Also check for common login page elements to ensure we're not on login page
        const loginForm = document.querySelector('#ctl00_mainContent_btnLogin');
        // If user div exists and we're not on login page, user is logged in
        return userDiv !== null && loginForm === null;
      }
    });
    const isLoggedIn = results[0].result;
    
    console.log('Login check result:', isLoggedIn);
    
    // Save to cache
    await saveLoginStateToCache(isLoggedIn);
    
    return isLoggedIn;
  } catch (error) {
    console.error('Error checking login:', error);
    // On error, invalidate cache to force re-check next time
    await invalidateLoginCache();
    return false;
  }
}

// Navigate to URL and wait for load
async function navigateToUrl(tabId, url, waitTime) {
  try {
    await chrome.tabs.update(tabId, { url });
    await new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, waitTime);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    return true;
  } catch (error) {
    console.error('Navigation error:', error);
    // Navigation failure might indicate user logged out, invalidate cache
    await invalidateLoginCache();
    return false;
  }
}

// Get current tab
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Parse date from DD/MM format
function parseDate(dateStr, year) {
  const [day, month] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

// Check if date is in range
function isDateInRange(date, startDate, endDate) {
  const d = new Date(date);
  const start = new Date(startDate);
  const end = new Date(endDate);
  return d >= start && d <= end;
}

// Check if week overlaps with date range
function weekOverlapsRange(weekStart, weekEnd, rangeStart, rangeEnd) {
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekEnd);
  const rangeStartDate = new Date(rangeStart);
  const rangeEndDate = new Date(rangeEnd);
  
  // Week overlaps if any day in week is in range
  return (weekStartDate <= rangeEndDate && weekEndDate >= rangeStartDate);
}

// Extract week information from dropdown
// Note: This function assumes the year dropdown is already set correctly
// It only reads the week options, it does NOT change the year dropdown
async function getWeekOptions(tabId) {
  try {
    // Just read the week options without changing the year
    // The year should already be set correctly before calling this function
    const weekResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const weekSelect = document.querySelector('#ctl00_mainContent_drpSelectWeek');
        if (!weekSelect) return [];
        
        const options = Array.from(weekSelect.options);
        return options.map(opt => ({
          value: opt.value,
          text: opt.text.trim()
        }));
      }
    });

    return weekResults[0].result || [];
  } catch (error) {
    console.error('Error getting week options:', error);
    return [];
  }
}

// Filter weeks by date range
function filterWeeksByRange(weekOptions, startDate, endDate, year) {
  const filtered = [];
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);
  
  // Normalize range dates to start of day for accurate comparison
  rangeStart.setHours(0, 0, 0, 0);
  rangeEnd.setHours(23, 59, 59, 999);
  
  for (let i = 0; i < weekOptions.length; i++) {
    const option = weekOptions[i];
    const isLastOption = i === weekOptions.length - 1;
    
    // Parse week range from text like "12/01 To 18/01" or "30/12 To 05/01"
    const match = option.text.match(/(\d{2}\/\d{2})\s+To\s+(\d{2}\/\d{2})/);
    if (!match) continue;
    
    const weekStartStr = match[1];
    const weekEndStr = match[2];
    
    // Parse dates to determine which year they belong to
    const [startDay, startMonth] = weekStartStr.split('/').map(Number);
    const [endDay, endMonth] = weekEndStr.split('/').map(Number);
    
    // Determine year for week dates (handle year boundaries)
    // IMPORTANT: The FIRST value in the dropdown spans the previous year to the current year.
    // The LAST value in the dropdown remains entirely in the current year.
    // Example when year dropdown shows 2025:
    // - First week "30/12 To 05/01" = Dec 30, 2024 to Jan 5, 2025 (spans boundary, previous year to current year)
    // - Last week "15/12 To 21/12" = Dec 15, 2025 to Dec 21, 2025 (entirely in current year, no boundary span)
    
    let weekStartYear = year;
    let weekEndYear = year;
    
    // If week spans year boundary (e.g., 30/12 To 05/01)
    // This pattern typically appears as the FIRST option in the dropdown
    if (startMonth === 12 && endMonth === 1) {
      // Week starts in December of (year-1), ends in January of year
      // This is the last week of (year-1), shown at the start of year's dropdown
      weekStartYear = year - 1;
      weekEndYear = year;
    } else if (startMonth > endMonth && startMonth !== 12) {
      // Week spans year boundary (e.g., November to January, but NOT December to January which is handled above)
      // This case is rare but possible
      weekStartYear = year - 1;
      weekEndYear = year;
    } else {
      // Week is within the same year
      // For "15/12 To 21/12" in 2025 dropdown = Dec 15, 2025 to Dec 21, 2025
      // This typically appears as the LAST option in the dropdown
      weekStartYear = year;
      weekEndYear = year;
      
      // Additional validation: if this is the last option and has December dates,
      // ensure it's treated as the current year (not previous year)
      if (isLastOption && startMonth === 12 && endMonth === 12) {
        // Last option with December dates is definitely in the current year
        weekStartYear = year;
        weekEndYear = year;
      }
    }
    
    const weekStartDate = parseDate(weekStartStr, weekStartYear);
    let weekEndDate = parseDate(weekEndStr, weekEndYear);
    
    // Normalize week dates to start/end of day for accurate comparison
    weekStartDate.setHours(0, 0, 0, 0);
    weekEndDate.setHours(23, 59, 59, 999);
    
    // Verify the dates make sense
    if (weekEndDate < weekStartDate) {
      // This shouldn't happen, but if it does, adjust
      weekEndYear = weekStartYear + 1;
      weekEndDate = parseDate(weekEndStr, weekEndYear);
      weekEndDate.setHours(23, 59, 59, 999);
    }
    
    // Check if week overlaps with date range
    const overlaps = weekOverlapsRange(weekStartDate, weekEndDate, rangeStart, rangeEnd);
    
    // Additional validation: calculate distance from range to catch year parsing errors
    // A week is "way outside" if it's more than 7 days (one week) away from the range
    // This allows partial overlaps (e.g., week 06/01-12/01 with range 08/01-14/01) 
    // but excludes weeks that are clearly unrelated (e.g., week 15/12-21/12 with range 01/01-04/30)
    const daysBeforeRange = Math.ceil((rangeStart - weekEndDate) / (1000 * 60 * 60 * 24));
    const daysAfterRange = Math.ceil((weekStartDate - rangeEnd) / (1000 * 60 * 60 * 24));
    
    const weekStartISO = weekStartDate.toISOString().split('T')[0];
    const weekEndISO = weekEndDate.toISOString().split('T')[0];
    const rangeStartISO = rangeStart.toISOString().split('T')[0];
    const rangeEndISO = rangeEnd.toISOString().split('T')[0];
    
    // Include week if it overlaps AND is not way outside the range
    // This handles partial overlaps correctly while excluding weeks that are clearly unrelated
    // Note: If overlaps is true, the week is by definition not "way outside", but we check
    // the distance anyway to catch potential year parsing errors that might cause false overlaps
    const isWayOutside = daysBeforeRange > 7 || daysAfterRange > 7;
    
    if (overlaps && !isWayOutside) {
      // Week overlaps with range and is not way outside - include it
      // This allows partial overlaps: if a week partially overlaps, include ALL classes from that week
      console.log(`Including week "${option.text}" (${weekStartISO} to ${weekEndISO}) for range ${rangeStartISO} to ${rangeEndISO} - overlaps`);
      
      filtered.push({
        value: option.value,
        text: option.text,
        startDate: weekStartISO,
        endDate: weekEndISO,
        startYear: weekStartYear,
        endYear: weekEndYear
      });
    } else {
      // Week does not overlap or is way outside - exclude it
      if (isWayOutside) {
        console.log(`Excluding week "${option.text}" (${weekStartISO} to ${weekEndISO}) - way outside range (${daysBeforeRange > 7 ? `${daysBeforeRange} days before` : `${daysAfterRange} days after`})`);
      } else {
        console.log(`Excluding week "${option.text}" (${weekStartISO} to ${weekEndISO}) - no overlap with range ${rangeStartISO} to ${rangeEndISO}`);
      }
    }
  }
  
  return filtered;
}

// Extract data from current page
async function extractWeekData(tabId) {
  try {
    // Create a promise that resolves when content script sends dataReady message
    // IMPORTANT: Set up listener BEFORE injecting script to avoid race condition
    const dataPromise = new Promise((resolve) => {
      let timeoutId = null;
      let listener = null;
      
      // Set up message listener
      listener = (message, sender) => {
        // Only accept messages from the correct tab
        if (sender.tab?.id === tabId && message.action === 'dataReady') {
          // Clean up
          if (timeoutId) clearTimeout(timeoutId);
          if (listener) chrome.runtime.onMessage.removeListener(listener);
          
          console.log('Received dataReady message from content script');
          resolve(message.data || []);
        }
      };
      
      // Add listener BEFORE injecting script
      chrome.runtime.onMessage.addListener(listener);
      
      // Timeout after configured delay - fallback to polling if message doesn't arrive
      timeoutId = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        console.log('Timeout waiting for dataReady message, falling back to polling');
        resolve(null); // Signal to use fallback
      }, WAIT_TIMES.DATA_READY_TIMEOUT);
    });
    
    // Inject content script (listener is already set up above)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    
    // Wait for dataReady message from content script
    let weekData = await dataPromise;
    
    // Fallback to polling if message wasn't received (for compatibility)
    if (weekData === null) {
      console.log('Using fallback polling method');
      // Wait a bit for content script to execute
      await new Promise(resolve => setTimeout(resolve, WAIT_TIMES.CONTENT_SCRIPT_INIT));
      
      // Get the extracted data
      const dataResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Check if content script ran
          if (typeof window.scrapedData === 'undefined') {
            console.error('Content script did not set window.scrapedData');
            // Try to run extraction manually
            if (typeof extractScheduleData === 'function') {
              window.scrapedData = extractScheduleData();
            } else {
              console.error('extractScheduleData function not found');
            }
          }
          return window.scrapedData || null;
        }
      });
      
      weekData = dataResults[0].result || [];
    }
    
    // Ensure we return an array
    if (!Array.isArray(weekData)) {
      console.warn('extractWeekData: data is not an array, converting:', weekData);
      weekData = weekData ? [weekData] : [];
    }
    
    return weekData;
  } catch (error) {
    console.error('Error extracting week data:', error);
    return [];
  }
}

// Select week in dropdown and wait for update
async function selectWeek(tabId, weekValue, waitTime) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (weekValue) => {
        const weekSelect = document.querySelector('#ctl00_mainContent_drpSelectWeek');
        if (weekSelect) {
          weekSelect.value = weekValue;
          // Trigger ASP.NET postback
          if (typeof __doPostBack === 'function') {
            __doPostBack('ctl00$mainContent$drpSelectWeek', '');
          } else {
            // Fallback: dispatch change event
            const event = new Event('change', { bubbles: true });
            weekSelect.dispatchEvent(event);
          }
        }
      },
      args: [weekValue]
    });
    
    // Wait for DOM update
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // Wait for table to be ready (with timeout)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (timeout) => {
          return new Promise((resolve, reject) => {
            const startTime = Date.now();
              const checkTable = () => {
                const table = document.querySelector('table thead th[rowspan="2"]');
                const tbody = document.querySelector('table tbody');
                if (table && tbody && tbody.querySelectorAll('tr').length > 0) {
                  resolve();
                } else if (Date.now() - startTime > timeout) {
                  reject(new Error('Table not ready within timeout'));
                } else {
                  setTimeout(checkTable, WAIT_TIMES.POLLING_INTERVAL);
                }
              };
            checkTable();
          });
        },
        args: [waitTime * 2] // Give it double the wait time
      });
    } catch (error) {
      console.warn('Table readiness check failed, proceeding anyway:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Error selecting week:', error);
    return false;
  }
}

// Helper function to send message to content script
async function sendMessageToContentScript(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Content script may not exist during navigation - this is expected
    // Silently ignore to avoid console spam during fast mode scraping
  }
}

// Inject minimal overlay script immediately (runs before full content script)
// This ensures overlay appears instantly on page load
async function injectMinimalOverlay(tabId, title, message, dismissText, progressText, extensionName) {
  try {
    console.log(`Injecting overlay to tab ${tabId}: ${title || '(from sessionStorage)'}`);
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (title, message, dismissText, progressText, extensionName) => {
        // Function to create overlay
        const createOverlayNow = () => {
          console.log('Creating overlay now, scraping active:', sessionStorage.getItem('fptu_scraping_active'));
          // Check if overlay already exists
          if (document.getElementById('fptu-calendar-overlay')) {
            console.log('Overlay already exists, skipping');
            return;
          }
          
          // Check sessionStorage
          const isScraping = sessionStorage.getItem('fptu_scraping_active') === 'true';
          if (!isScraping && !title) {
            return; // Don't show if not scraping
          }
          
          // Use provided values or fallback to sessionStorage
          // Note: sessionStorage is accessed here (in page context), not in background script
          const overlayTitle = title || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_overlay_title') : null) || 'Đang trích xuất lịch học';
          const overlayMessage = message || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_overlay_message') : null) || 'Đang trích xuất lịch học cho bạn...';
          const overlayDismiss = dismissText || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_overlay_dismiss') : null) || 'Đóng';
          const overlayProgress = progressText || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_scraping_progress') : null) || '';
          const extName = extensionName || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('fptu_extension_name') : null) || 'FPTU Study Calendar';
          
          // Create style element if it doesn't exist
          let styleEl = document.getElementById('fptu-calendar-overlay-style');
          if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'fptu-calendar-overlay-style';
            styleEl.textContent = `
              #fptu-calendar-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              }
              #fptu-calendar-overlay .overlay-content {
                background: #ffffff;
                border-radius: 12px;
                padding: 32px;
                max-width: 400px;
                width: 90%;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                text-align: center;
              }
              #fptu-calendar-overlay .overlay-extension-name {
                font-size: 12px;
                font-weight: 500;
                color: #10b981;
                margin-bottom: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
              }
              #fptu-calendar-overlay .overlay-title {
                font-size: 20px;
                font-weight: 600;
                color: #171717;
                margin-bottom: 8px;
                line-height: 1.2;
              }
              #fptu-calendar-overlay .overlay-message {
                font-size: 14px;
                color: #525252;
                margin-bottom: 24px;
                line-height: 1.5;
              }
              #fptu-calendar-overlay .overlay-progress {
                font-size: 16px;
                font-weight: 500;
                color: #10b981;
                margin-bottom: 24px;
                min-height: 24px;
              }
              #fptu-calendar-overlay .spinner {
                width: 40px;
                height: 40px;
                margin: 0 auto 24px;
                border: 4px solid #e5e5e5;
                border-top-color: #10b981;
                border-radius: 50%;
                animation: spin 1s linear infinite;
              }
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
              #fptu-calendar-overlay .overlay-button {
                background: #10b981;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s;
                font-family: inherit;
                display: block;
                margin: 0 auto;
              }
              #fptu-calendar-overlay .overlay-button:hover {
                background: #059669;
              }
              #fptu-calendar-overlay .overlay-button:active {
                transform: scale(0.98);
              }
              #fptu-calendar-overlay.complete .spinner {
                display: none;
              }
              #fptu-calendar-overlay.complete .overlay-progress {
                color: #10b981;
                font-weight: 600;
              }
            `;
            (document.head || document.documentElement).appendChild(styleEl);
          }
          
          // Create overlay element
          const overlay = document.createElement('div');
          overlay.id = 'fptu-calendar-overlay';
          overlay.innerHTML = `
            <div class="overlay-content">
              <div class="overlay-extension-name">${extName}</div>
              <div class="overlay-title">${overlayTitle}</div>
              <div class="overlay-message">${overlayMessage}</div>
              <div class="spinner"></div>
              <div class="overlay-progress">${overlayProgress}</div>
              <button class="overlay-button" id="overlay-dismiss" style="display: none;">${overlayDismiss}</button>
            </div>
          `;
          
          // Add dismiss handler
          overlay.querySelector('#overlay-dismiss').addEventListener('click', () => {
            overlay.remove();
          });
          
          // Append to body (or documentElement if body doesn't exist yet)
          const target = document.body || document.documentElement;
          target.appendChild(overlay);
        };
        
        // Try to create immediately
        if (document.readyState === 'loading') {
          // If still loading, wait for DOMContentLoaded
          if (document.addEventListener) {
            document.addEventListener('DOMContentLoaded', createOverlayNow, { once: true });
          } else {
            // Fallback for older browsers
            const checkReady = setInterval(() => {
              if (document.readyState !== 'loading') {
                clearInterval(checkReady);
                createOverlayNow();
              }
            }, 10);
          }
        } else {
          // DOM is ready, create immediately
          createOverlayNow();
        }
      },
      args: [title, message, dismissText, progressText, extensionName],
      world: 'MAIN' // Run in main world for immediate execution
    });
  } catch (error) {
    console.log('Could not inject minimal overlay:', error.message);
  }
}

// Track active scraping sessions for overlay injection
const activeScrapingTabs = new Map(); // tabId -> { title, message, dismissText }

// Clean up activeScrapingTabs when tabs are closed to prevent memory leaks
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeScrapingTabs.has(tabId)) {
    console.log('Tab closed, removing from activeScrapingTabs:', tabId);
    activeScrapingTabs.delete(tabId);
  }
});

// Listen for tab updates to inject overlay immediately when page starts loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Log all tab updates for debugging
  if (changeInfo.status) {
    console.log(`Tab ${tabId} status: ${changeInfo.status}, URL: ${tab.url ? tab.url.substring(tab.url.lastIndexOf('/') + 1) : 'unknown'}, activeScrapingTabs has: ${activeScrapingTabs.has(tabId)}`);
  }
  
  // Handle both timetable page and attendance page (fast mode)
  const isSchedulePage = tab.url && tab.url.includes('ScheduleOfWeek.aspx');
  const isAttendancePage = tab.url && tab.url.includes('ViewAttendstudent.aspx');
  
  if (!isSchedulePage && !isAttendancePage) {
    return;
  }
  
  // If page is loading and we have active scraping for this tab
  if (changeInfo.status === 'loading' && activeScrapingTabs.has(tabId)) {
    const overlayData = activeScrapingTabs.get(tabId);
    console.log(`Tab ${tabId} loading - re-injecting overlay`);
    
    // Inject overlay immediately (don't wait)
    // Progress text will be read from sessionStorage inside the injected script
    injectMinimalOverlay(tabId, overlayData.title, overlayData.message, overlayData.dismissText, null, overlayData.extensionName).catch((error) => {
      console.log(`Failed to inject overlay during navigation: ${error.message}`);
    });
  }
  
  // Also try on complete status as a fallback
  if (changeInfo.status === 'complete' && activeScrapingTabs.has(tabId)) {
    const overlayData = activeScrapingTabs.get(tabId);
    console.log(`Tab ${tabId} complete - ensuring overlay is present`);
    
    injectMinimalOverlay(tabId, overlayData.title, overlayData.message, overlayData.dismissText, null, overlayData.extensionName).catch((error) => {
      console.log(`Failed to inject overlay on complete: ${error.message}`);
    });
  }
});

// Main scraping function
async function startScraping(startDate, endDate, waitTime) {
  const errors = [];
  const allWeeksData = [];
  let timetableTab = null;
  let shouldCloseTab = false; // Track if we created a new tab that should be closed on error
  let tabToClose = null; // Track the tab ID that should be closed on error
  let scrapingSuccessful = false; // Track if scraping completed successfully
  
  try {
    // Step 1: Check if this is the first run (after install/reload)
    const isFirstRunFlag = await isFirstRun();
    
    // Step 2: Check cache to determine if we need login check
    const cachedLoginState = await getCachedLoginState();
    // If first run or cache says false/null, always force login check
    // We can't trust a false cache because user might have logged in since then
    // We can trust a true cache (unless first run) because we verify before scraping
    const needsLoginCheck = isFirstRunFlag || cachedLoginState === null || cachedLoginState === false;
    const isLoggedInFromCache = cachedLoginState === true;
    
    if (isFirstRunFlag) {
      console.log('First run detected, will force login check');
    }
    
    // Step 3: Find existing FAP tab or create new one based on login state
    let fapTab = await findExistingFAPTab();
    
    if (!fapTab) {
      // No existing tab found
      // On first run, always go to homepage to ensure proper login check
      if (isFirstRunFlag) {
        console.log('First run: creating tab to homepage for login check');
        fapTab = await chrome.tabs.create({ url: FAP_BASE_URL, active: false });
        shouldCloseTab = true;
        tabToClose = fapTab.id;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else if (isLoggedInFromCache) {
        // Cache says logged in, create tab directly to timetable page (skip homepage)
        console.log('Cache indicates logged in, creating tab directly to timetable page');
        fapTab = await chrome.tabs.create({ url: TIMETABLE_URL, active: false });
        shouldCloseTab = true;
        tabToClose = fapTab.id;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        timetableTab = fapTab;
      } else {
        // Need to check login, create tab to homepage
        console.log('Cache invalid/missing, creating tab to homepage for login check');
        fapTab = await chrome.tabs.create({ url: FAP_BASE_URL, active: false });
        shouldCloseTab = true;
        tabToClose = fapTab.id;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    } else {
      console.log('Reusing existing FAP tab:', fapTab.id);
      // If we found an existing tab, make sure it's loaded
      const tabInfo = await chrome.tabs.get(fapTab.id);
      if (tabInfo.status !== 'complete') {
        await new Promise(resolve => {
          const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === fapTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(resolve, waitTime);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    }
    
    // Step 4: Perform login check only if needed
    if (needsLoginCheck) {
      if (isFirstRunFlag) {
        console.log('First run: performing login check');
      } else {
        console.log('Cache invalid/missing, performing login check');
      }
      const isLoggedIn = await checkLogin(fapTab.id, false);
      if (!isLoggedIn) {
        // Show alert to user
        await chrome.scripting.executeScript({
          target: { tabId: fapTab.id },
          func: () => {
            alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
          }
        });
        throw new Error('NOT_LOGGED_IN');
      }
      console.log('Login check passed, user is logged in');
      // Mark first run as completed after successful login check
      if (isFirstRunFlag) {
        await markFirstRunCompleted();
      }
    } else if (!isLoggedInFromCache) {
      // Cache says not logged in, but check anyway (user might have logged in since then)
      console.log('Cached state indicates not logged in, performing login check');
      const isLoggedIn = await checkLogin(fapTab.id, true); // Force check to update cache
      if (!isLoggedIn) {
        await chrome.scripting.executeScript({
          target: { tabId: fapTab.id },
          func: () => {
            alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
          }
        });
        throw new Error('NOT_LOGGED_IN');
      }
    } else {
      // Cache says logged in, but we should still verify before scraping
      // This catches cases where user logged out but cache is stale
      console.log('Cache indicates logged in, will verify login state before scraping');
    }
    
    // Step 5: Navigate to timetable page if not already there
    // (Only if we haven't already created a tab directly to timetable page)
    if (!timetableTab) {
      const isAlreadyOnTimetable = await isOnTimetablePage(fapTab.id);
      if (!isAlreadyOnTimetable) {
        console.log('Not on timetable page, navigating...');
        timetableTab = fapTab;
        if (shouldCloseTab) {
          tabToClose = timetableTab.id;
        }
        await navigateToUrl(timetableTab.id, TIMETABLE_URL, waitTime);
      } else {
        console.log('Already on timetable page, reusing it');
        timetableTab = fapTab;
        if (shouldCloseTab) {
          tabToClose = timetableTab.id;
        }
      }
    } else if (shouldCloseTab) {
      // timetableTab was already set, update tabToClose
      tabToClose = timetableTab.id;
    }
    
    // Step 5.5: Always verify login state before starting to scrape
    // This is critical to catch stale cache cases where user logged out
    // We verify by checking if we can access the timetable page properly
    console.log('Verifying login state before scraping...');
    const isActuallyLoggedIn = await isOnTimetablePage(timetableTab.id);
    
    if (!isActuallyLoggedIn) {
      // User is not actually logged in, invalidate cache and show error
      console.log('Login verification failed - user is not logged in');
      await invalidateLoginCache();
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: () => {
          alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
        }
      });
      throw new Error('NOT_LOGGED_IN');
    }
    
    // If we got here, user is logged in - update cache to ensure it's fresh
    if (isLoggedInFromCache) {
      console.log('Login verification passed, cache was correct');
    } else {
      // Cache was wrong, update it
      console.log('Login verification passed, updating cache');
      await saveLoginStateToCache(true);
    }
    
    // Get localized messages for overlay
    const overlayTitle = chrome.i18n.getMessage('overlayTitle');
    const overlayMessage = chrome.i18n.getMessage('overlayMessage');
    const overlayDismiss = chrome.i18n.getMessage('overlayDismiss');
    const extensionName = chrome.i18n.getMessage('extensionName');
    
    // Register this tab for overlay injection on page loads
    activeScrapingTabs.set(timetableTab.id, {
      title: overlayTitle,
      message: overlayMessage,
      dismissText: overlayDismiss,
      extensionName: extensionName
    });
    
    // Set sessionStorage flag to indicate scraping is starting
    // This ensures overlay persists across page reloads
    await chrome.scripting.executeScript({
      target: { tabId: timetableTab.id },
      func: (title, message, dismissText, extName) => {
        sessionStorage.setItem('fptu_scraping_active', 'true');
        sessionStorage.setItem('fptu_overlay_title', title);
        sessionStorage.setItem('fptu_overlay_message', message);
        sessionStorage.setItem('fptu_overlay_dismiss', dismissText);
        sessionStorage.setItem('fptu_extension_name', extName);
      },
      args: [overlayTitle, overlayMessage, overlayDismiss, extensionName]
    });
    
    // Immediately inject minimal overlay (appears instantly)
    await injectMinimalOverlay(timetableTab.id, overlayTitle, overlayMessage, overlayDismiss, '', extensionName);
    
    // Step 3: Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: timetableTab.id },
      files: ['content.js']
    });
    
    // Wait briefly for content script to initialize
    await new Promise(resolve => setTimeout(resolve, WAIT_TIMES.OVERLAY_INIT));
    
    // Send message to show overlay with localized strings
    // Content script will check sessionStorage first, but this ensures it shows if sessionStorage wasn't set
    await sendMessageToContentScript(timetableTab.id, {
      action: 'showOverlay',
      title: overlayTitle,
      message: overlayMessage,
      dismissText: overlayDismiss
    });
    
    // Step 4: Determine year from start date
    const year = new Date(startDate).getFullYear();
    
    // Step 5: Check current year dropdown value and update if necessary
    const currentYearResult = await chrome.scripting.executeScript({
      target: { tabId: timetableTab.id },
      func: () => {
        const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
        if (yearSelect) {
          return parseInt(yearSelect.value, 10);
        }
        return null;
      }
    });
    
    const currentYear = currentYearResult[0].result;
    const needsYearUpdate = currentYear === null || currentYear !== year;
    
    if (needsYearUpdate) {
      console.log(`Current year dropdown: ${currentYear}, updating to: ${year}`);
      // Select year
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: (year) => {
          const yearSelect = document.querySelector('#ctl00_mainContent_drpYear');
          if (yearSelect) {
            yearSelect.value = year.toString();
            if (typeof __doPostBack === 'function') {
              __doPostBack('ctl00$mainContent$drpYear', '');
            }
          }
        },
        args: [year]
      });
      
      // Wait for DOM to load after year change
      await new Promise(resolve => setTimeout(resolve, waitTime));
    } else {
      console.log(`Year dropdown already set to ${year}, skipping update`);
    }
    
    // Step 6: Get week options (always fetch fresh after potential year change)
    // If we updated the year, the week dropdown should already be updated
    // If we didn't update, we still need to read the current week options
    const weekOptions = await getWeekOptions(timetableTab.id);
    
    // Step 7: Filter weeks by date range
    const weeksToScrape = filterWeeksByRange(weekOptions, startDate, endDate, year);
    
    console.log(`Found ${weeksToScrape.length} weeks to scrape`);
    
    // Step 8: Iterate through weeks
    for (let i = 0; i < weeksToScrape.length; i++) {
      const week = weeksToScrape[i];
      
      // Send progress update to popup
      try {
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          currentWeek: i + 1,
          totalWeeks: weeksToScrape.length
        }).catch(() => {}); // Ignore errors if popup is closed
      } catch (e) {
        // Ignore errors
      }
      
          // Get localized progress message
          const progressText = chrome.i18n.getMessage('overlayProgress', [
            (i + 1).toString(),
            weeksToScrape.length.toString()
          ]);
          
          // IMPORTANT: Set sessionStorage BEFORE selecting week (which causes page reload)
          // This ensures overlay persists across page reloads
          await chrome.scripting.executeScript({
            target: { tabId: timetableTab.id },
            func: (weekNum, totalWeeks, progressText) => {
              sessionStorage.setItem('fptu_scraping_active', 'true');
              sessionStorage.setItem('fptu_scraping_week', weekNum.toString());
              sessionStorage.setItem('fptu_scraping_total', totalWeeks.toString());
              sessionStorage.setItem('fptu_scraping_progress', progressText);
            },
            args: [i + 1, weeksToScrape.length, progressText]
          });
          
          // Send progress update to content script for overlay (if page hasn't reloaded yet)
          await sendMessageToContentScript(timetableTab.id, {
            action: 'updateOverlayProgress',
            currentWeek: i + 1,
            totalWeeks: weeksToScrape.length,
            progressText: progressText
          });
          
          // The tabs.onUpdated listener will inject overlay immediately when page starts loading
      
      // IMPORTANT: We should NOT switch years based on week.startYear
      // The week appears in the current year's dropdown, so we should stay on that year
      // The week.startYear is only used for date parsing, not for which dropdown to use
      // For example, week "29/12 To 04/01" appears in 2026 dropdown, so we stay on 2026
      // even though the week starts in 2025
      
      // Pass the correct year for date parsing to content script
      // For weeks that span year boundaries, we need to tell content script which year to use
      // for parsing dates. For "29/12 To 04/01" in 2026 dropdown:
      // - December dates (29/12) should use 2025
      // - January dates (04/01) should use 2026
      // The content script will handle this based on weekSpansBoundary flag
      
      // Set the expected year for date parsing
      // For boundary weeks, we need to pass both the selected year (for the dropdown)
      // and the base year (for parsing December dates)
      const baseYearForParsing = week.startYear || year;
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: (selectedYear, baseYear) => {
          // Store both the selected year (dropdown year) and base year (for parsing)
          window.__selectedYear = selectedYear;
          window.__baseYear = baseYear;
        },
        args: [year, baseYearForParsing]
      });
      
      let success = false;
      let retries = 0;
      
      while (!success && retries < MAX_RETRIES) {
        try {
          // Select week (this will cause page reload via postback)
          // The tabs.onUpdated listener will inject overlay immediately when page starts loading
          const selectSuccess = await selectWeek(timetableTab.id, week.value, waitTime);
          if (!selectSuccess) {
            throw new Error('Failed to select week');
          }
          
          // After page reload, re-inject content script
          // Content script will check sessionStorage and show overlay immediately
          await chrome.scripting.executeScript({
            target: { tabId: timetableTab.id },
            files: ['content.js']
          });
          
          // Wait briefly for content script to initialize
          await new Promise(resolve => setTimeout(resolve, WAIT_TIMES.OVERLAY_INIT));
          
          // Send progress update to content script (overlay should already be showing)
          await sendMessageToContentScript(timetableTab.id, {
            action: 'updateOverlayProgress',
            currentWeek: i + 1,
            totalWeeks: weeksToScrape.length,
            progressText: progressText
          });
          
                // Extract data
          const weekData = await extractWeekData(timetableTab.id);
          // weekData is now always an array (empty if no classes)
          if (Array.isArray(weekData)) {
            allWeeksData.push({
              weekNumber: parseInt(week.value),
              weekRange: week.text,
              startDate: week.startDate,
              endDate: week.endDate,
              classes: weekData
            });
            success = true;
            console.log(`Successfully scraped week ${week.text}: ${weekData.length} classes`);
          } else {
            throw new Error('Failed to extract data - invalid format');
          }
        } catch (error) {
          // Check if error might be due to login expiration
          if (error.message.includes('login') || error.message.includes('Login') || 
              error.message.includes('NOT_LOGGED_IN') || error.message.includes('unauthorized')) {
            console.log('Possible login expiration detected, invalidating cache');
            await invalidateLoginCache();
            throw new Error('NOT_LOGGED_IN');
          }
          
          retries++;
          if (retries >= MAX_RETRIES) {
            errors.push({
              week: week.text,
              error: error.message
            });
            console.error(`Failed to scrape week ${week.text} after ${MAX_RETRIES} retries:`, error);
          } else {
            console.log(`Retrying week ${week.text} (attempt ${retries + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
    }
    
    // Send completion message to popup
    try {
      chrome.runtime.sendMessage({
        action: 'scrapingComplete',
        totalWeeks: weeksToScrape.length,
        successCount: allWeeksData.length,
        errorCount: errors.length
      }).catch(() => {});
    } catch (e) {
      // Ignore errors
    }
    
    // Send completion message to content script to update overlay
    if (timetableTab) {
      // Generate completion text with week count
      const completeText = chrome.i18n.getMessage('overlayCompleteWithWeeks', [
        allWeeksData.length.toString(),
        weeksToScrape.length.toString()
      ]);
      
      // Remove from active scraping tabs
      activeScrapingTabs.delete(timetableTab.id);
      
      // Clear sessionStorage flags
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: () => {
          sessionStorage.removeItem('fptu_scraping_active');
          sessionStorage.removeItem('fptu_scraping_week');
          sessionStorage.removeItem('fptu_scraping_total');
          sessionStorage.removeItem('fptu_scraping_progress');
        }
      });
      
      await sendMessageToContentScript(timetableTab.id, {
        action: 'scrapingComplete',
        totalWeeks: weeksToScrape.length,
        successCount: allWeeksData.length,
        errorCount: errors.length,
        completeText: completeText
      });
    }
    
    // Mark scraping as successful before returning
    scrapingSuccessful = true;
    
    // Return results
    return {
      success: true,
      data: {
        year,
        weeks: allWeeksData
      },
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error('Scraping error:', error);
    
    // Clear sessionStorage and hide overlay on error
    if (timetableTab) {
      // Remove from active scraping tabs
      activeScrapingTabs.delete(timetableTab.id);
      
      await chrome.scripting.executeScript({
        target: { tabId: timetableTab.id },
        func: () => {
          sessionStorage.removeItem('fptu_scraping_active');
          sessionStorage.removeItem('fptu_scraping_week');
          sessionStorage.removeItem('fptu_scraping_total');
          sessionStorage.removeItem('fptu_scraping_progress');
        }
      });
      
      await sendMessageToContentScript(timetableTab.id, {
        action: 'hideOverlay'
      });
    }
    
    return {
      success: false,
      error: error.message
    };
  } finally {
    // Always cleanup: close tab if we created it and scraping failed
    if (shouldCloseTab && tabToClose && !scrapingSuccessful) {
      try {
        console.log('Cleaning up: closing tab', tabToClose, 'due to error');
        await chrome.tabs.remove(tabToClose);
      } catch (e) {
        // Tab may already be closed by user or browser
        console.log('Tab already closed or could not be removed:', e.message);
      }
    }
    
    // Always cleanup activeScrapingTabs entry if scraping didn't complete successfully
    // (Successful completion already cleans up in the try block)
    if (timetableTab && !scrapingSuccessful && activeScrapingTabs.has(timetableTab.id)) {
      console.log('Cleaning up: removing from activeScrapingTabs due to error');
      activeScrapingTabs.delete(timetableTab.id);
    }
  }
}

// Flatten weeks data to classes array
function flattenWeeksToClasses(weeksData) {
  const classes = [];
  if (weeksData && weeksData.weeks) {
    weeksData.weeks.forEach(week => {
      if (week.classes && Array.isArray(week.classes)) {
        week.classes.forEach(cls => {
          classes.push(cls);
        });
      }
    });
  }
  return classes;
}

// ========================================
// FAST MODE: CACHE MANAGEMENT
// ========================================

/**
 * Get cached semesters data
 * @returns {Promise<Object|null>} Cached data or null if expired/missing
 */
async function getCachedSemesters() {
  try {
    const cached = await chrome.storage.local.get(FAST_MODE_CACHE_KEY);
    if (!cached[FAST_MODE_CACHE_KEY]) return null;
    
    const data = cached[FAST_MODE_CACHE_KEY];
    const age = Date.now() - data.lastFetch;
    
    if (age > CACHE_TTL_MS) {
      console.log('Fast mode cache expired');
      return null;
    }
    
    console.log('Using cached semesters data');
    return data;
  } catch (error) {
    console.error('Error getting cached semesters:', error);
    return null;
  }
}

/**
 * Save semesters to cache
 * @param {Array} semesters - List of semester objects
 */
async function setCachedSemesters(semesters) {
  try {
    await chrome.storage.local.set({
      [FAST_MODE_CACHE_KEY]: {
        semesters,
        lastFetch: Date.now(),
        version: 1
      }
    });
    console.log('Cached semesters data');
  } catch (error) {
    console.error('Error caching semesters:', error);
  }
}

/**
 * Invalidate semester cache
 */
async function invalidateCache() {
  try {
    await chrome.storage.local.remove(FAST_MODE_CACHE_KEY);
    console.log('Invalidated fast mode cache');
  } catch (error) {
    console.error('Error invalidating cache:', error);
  }
}

// ========================================
// FAST MODE: ATTENDANCE PAGE EXTRACTION
// ========================================

/**
 * Navigate to attendance page
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function navigateToAttendancePage(tabId) {
  return navigateToUrl(tabId, ATTENDANCE_URL, WAIT_TIMES.ATTENDANCE_PAGE_READY);
}

/**
 * Extract semesters list from attendance page
 * @param {number} tabId
 * @returns {Promise<Array>} [{id, name, url, isLatest}]
 */
async function extractSemestersFromAttendance(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const termDiv = document.getElementById('ctl00_mainContent_divTerm');
        if (!termDiv) return [];
        
        const semesters = [];
        const rows = Array.from(termDiv.querySelectorAll('tr'));
        
        rows.forEach(row => {
          const cell = row.querySelector('td');
          if (!cell) return;
          
          const link = cell.querySelector('a');
          const boldCurrent = cell.querySelector('b');
          
          if (boldCurrent && !link) {
            // Current semester (bold, no link)
            const name = boldCurrent.textContent.trim();
            semesters.push({ id: null, name, url: null, isLatest: true, isCurrent: true });
          } else if (link) {
            // Past semester (has link)
            const url = link.getAttribute('href');
            const name = link.textContent.trim();
            const idMatch = url.match(/term=(\d+)/);
            const id = idMatch ? idMatch[1] : null;
            semesters.push({ id, name, url, isLatest: false, isCurrent: false });
          }
        });
        
        // Mark the last semester as latest if no current was found
        if (semesters.length > 0 && !semesters.some(s => s.isLatest)) {
          semesters[semesters.length - 1].isLatest = true;
        }
        
        return semesters;
      }
    });
    
    return result[0].result || [];
  } catch (error) {
    console.error('Error extracting semesters:', error);
    return [];
  }
}

/**
 * Extract courses from attendance page
 * @param {number} tabId
 * @returns {Promise<Array>} [{code, url, isCurrent}]
 */
async function extractCoursesFromAttendance(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const courseDiv = document.getElementById('ctl00_mainContent_divCourse');
        if (!courseDiv) return [];
        
        const courses = [];
        const rows = Array.from(courseDiv.querySelectorAll('tr'));
        
        rows.forEach(row => {
          const cell = row.querySelector('td');
          if (!cell) return;
          
          const link = cell.querySelector('a');
          const boldCurrent = cell.querySelector('b');
          
          // Extract course code from text like "SW Architecture(SWD392)"
          const extractCode = (text) => {
            const match = text.match(/\(([A-Z0-9c]+)\)/);
            return match ? match[1] : null;
          };
          
          if (boldCurrent && !link) {
            // Current course (bold, no link)
            const text = boldCurrent.textContent.trim();
            const code = extractCode(text);
            if (code) {
              courses.push({ code, url: null, isCurrent: true });
            }
          } else if (link) {
            // Other courses (have links)
            const url = link.getAttribute('href');
            const text = link.textContent.trim();
            const code = extractCode(text);
            if (code) {
              courses.push({ code, url, isCurrent: false });
            }
          }
        });
        
        return courses;
      }
    });
    
    return result[0].result || [];
  } catch (error) {
    console.error('Error extracting courses:', error);
    return [];
  }
}

/**
 * Extract attendance table for a course
 * @param {number} tabId
 * @param {string} courseCode
 * @returns {Promise<Array>} Schedule rows
 */
/**
 * Extract attendance table from currently loaded page (tab context)
 * @param {number} tabId - Tab ID to execute script in
 * @param {string} courseCode - Course code for logging
 * @returns {Promise<Array>} Array of schedule objects
 */
async function extractAttendanceTable(tabId, courseCode) {
  try {
    // Wait for table to potentially load via JavaScript
    await new Promise(r => setTimeout(r, 1000));
    
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (code) => {
        try {
          // Find any table with tbody that has data rows
          let attendanceTable = null;
          const tables = Array.from(document.querySelectorAll('table.table-bordered, table.table1'));
          
          for (const table of tables) {
            const tbodies = Array.from(table.querySelectorAll('tbody'));
            // Find the tbody with actual data rows (has tr with td)
            for (const tbody of tbodies) {
              const rows = Array.from(tbody.querySelectorAll('tr'));
              const dataRows = rows.filter(r => r.querySelectorAll('td').length >= 7);
              if (dataRows.length > 0) {
                attendanceTable = table;
                break;
              }
            }
            if (attendanceTable) break;
          }
          
          if (!attendanceTable) {
            return { success: true, schedules: [], debug: `No data table found (checked ${tables.length} tables)` };
          }
          
          // Find the tbody with actual data
          const tbodies = Array.from(attendanceTable.querySelectorAll('tbody'));
          let dataBody = null;
          for (const tbody of tbodies) {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            if (rows.some(r => r.querySelectorAll('td').length >= 7)) {
              dataBody = tbody;
              break;
            }
          }
          if (!dataBody) dataBody = tbodies[tbodies.length - 1]; // Fallback to last tbody
          
          const rows = Array.from(dataBody.querySelectorAll('tr'));
          const schedules = [];
          let validRows = 0;
          let debugRows = [];
          
          rows.forEach((row, idx) => {
            const cells = Array.from(row.querySelectorAll('td'));
            const ths = Array.from(row.querySelectorAll('th'));
            const rowText = row.textContent.trim().substring(0, 50);
            debugRows.push(`Row${idx}[td=${cells.length},th=${ths.length}]:"${rowText}"`);
            
            if (cells.length < 7) return;
            
            validRows++;
            
            // Parse date from cell[1]
            const dateCell = cells[1];
            const dateSpan = dateCell.querySelector('span.label-primary, span.label');
            const dateText = (dateSpan ? dateSpan.textContent : dateCell.textContent).trim();
            const dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (!dateMatch) return;
            
            // Parse slot from cell[2]
            const slotCell = cells[2];
            const slotSpan = slotCell.querySelector('span.label-danger, span.label');
            const slotText = (slotSpan ? slotSpan.textContent : slotCell.textContent).trim();
            // Allow 1- or 2-digit hours (e.g., 7:30-9:00)
            const slotMatch = slotText.match(/^(\d+)_\((\d{1,2}:\d{2})-(\d{1,2}:\d{2})\)/);
            if (!slotMatch) return;
            
            const slotNum = parseInt(slotMatch[1]);
            const padTime = (t) => {
              const [h, m] = t.split(':');
              return `${h.padStart(2, '0')}:${m}`;
            };
            const startTime = padTime(slotMatch[2]);
            const endTime = padTime(slotMatch[3]);
            
            // Parse status from cell[6]
            const statusCell = cells[6];
            const statusText = statusCell.textContent.trim().toLowerCase();
            let status = 'not-yet';
            if (statusText.includes('present') || statusText.includes('attended')) status = 'attended';
            else if (statusText.includes('absent')) status = 'absent';
            else if (statusText.includes('future') || statusText.includes('not-yet')) status = 'not-yet';
            
            schedules.push({
              date: dateMatch[0],
              slotNum,
              time: { start: startTime, end: endTime },
              location: cells[3].textContent.trim(),
              lecturer: cells[4].textContent.trim(),
              groupName: cells[5].textContent.trim(),
              status
            });
          });
          
          return { success: true, schedules, debug: `${rows.length} total rows, ${validRows} with data, extracted ${schedules.length}. Details: ${debugRows.join('; ')}` };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      args: [courseCode]
    });
    
    const data = result[0].result;
    if (!data.success) {
      console.error(`Failed to extract ${courseCode}: ${data.error}`);
      return [];
    }
    
    const debugMsg = data.debug ? ` (${data.debug})` : '';
    console.log(`Extracted ${data.schedules.length} classes from ${courseCode}${debugMsg}`);
    return data.schedules;
  } catch (error) {
    console.error(`Error extracting ${courseCode}:`, error);
    return [];
  }
}

/**
 * Normalize attendance data to class objects
 * @param {Array} scheduleRows
 * @param {Object} course
 * @param {string} semesterId
 * @returns {Array} Normalized class objects
 */
function normalizeAttendanceData(scheduleRows, course, semesterId) {
  return scheduleRows.map(row => {
    // Convert date DD/MM/YYYY to YYYY-MM-DD
    const [day, month, year] = row.date.split('/').map(Number);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = new Date(year, month - 1, day);
    
    // Get day name
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[date.getDay()];
    
    return {
      subjectCode: course.code,
      day: dayName,
      date: dateStr,
      slot: row.slotNum,
      time: row.time,
      location: row.location,
      status: row.status,
      // Generate unique activity ID for fast mode
      activityId: `fast_${course.code}-${semesterId}-${dateStr}-${row.slotNum}`,
      scrapeMode: 'fast',
      sourcePage: 'attendance',
      // Rich metadata fields (null in fast mode)
      isOnline: null,
      meetUrl: null,
      edunextUrl: null,
      materialsUrl: null,
      isRelocated: false,
      // Additional context
      lecturer: row.lecturer,
      groupName: row.groupName
    };
  });
}

/**
 * Main fast mode scraping orchestrator
 * @param {string} semesterId - Selected semester ID
 * @param {number} waitTime - Wait time between operations
 * @returns {Promise<Object>} {success, data, mode}
 */
async function startScrapingFastMode(semesterId, waitTime) {
  const errors = [];
  const allClasses = [];
  let attendanceTab = null;
  let shouldCloseTab = false;
  let scrapingSuccessful = false;
  
  try {
    console.log('Starting fast mode scraping for semester:', semesterId);
    
    // Step 1: Login check
    const cachedLogin = await getCachedLoginState();
    const needsCheck = cachedLogin !== true;
    
    // Step 2: Find or create attendance tab
    let fapTab = await findExistingFAPTab();
    if (!fapTab) {
      fapTab = await chrome.tabs.create({ url: ATTENDANCE_URL, active: false });
      shouldCloseTab = true;
      await new Promise(r => setTimeout(r, waitTime));
    }
    attendanceTab = fapTab;
    
    if (needsCheck) {
      const isLoggedIn = await checkLogin(attendanceTab.id);
      if (!isLoggedIn) {
        await chrome.scripting.executeScript({
          target: { tabId: attendanceTab.id },
          func: () => {
            alert('Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.');
          }
        });
        throw new Error('NOT_LOGGED_IN');
      }
      await markFirstRunCompleted();
    }
    
    // Step 3: Navigate to attendance page
    await navigateToAttendancePage(attendanceTab.id);

    // Always verify login after navigation (cache may be stale)
    const stillLoggedIn = await checkLogin(attendanceTab.id);
    if (!stillLoggedIn) {
      await markFirstRunCompleted();
      throw new Error('NOT_LOGGED_IN');
    }
    await markFirstRunCompleted();
    
    // Step 4: Navigate to selected semester if not current
    const semesters = await extractSemestersFromAttendance(attendanceTab.id);
    const selectedSemester = semesters.find(s => s.id === semesterId || (s.isCurrent && !semesterId));
    
    // Use semester name for activity ID (e.g., "Spring2026" instead of ID "47")
    const semesterName = selectedSemester ? selectedSemester.name : null;
    
    if (selectedSemester && selectedSemester.url) {
      await navigateToUrl(attendanceTab.id, `${ATTENDANCE_URL}${selectedSemester.url}`, WAIT_TIMES.SEMESTER_SUBJECT_LOAD);
    }
    
    // Step 5: Extract courses for semester
    const courses = await extractCoursesFromAttendance(attendanceTab.id);
    console.log(`Found ${courses.length} courses in semester`);
    
    if (courses.length === 0) {
      const loggedIn = await checkLogin(attendanceTab.id);
      if (!loggedIn) {
        throw new Error('NOT_LOGGED_IN');
      }
      throw new Error('NO_COURSES');
    }
    
    // Step 6: Setup overlay - store in sessionStorage for persistence across page loads
    const overlayTitle = chrome.i18n.getMessage('fastModeTitle') || 'Trích xuất nhanh';
    const overlayMessage = chrome.i18n.getMessage('fastModeMessage') || 'Đang trích xuất lịch học...';
    const dismissText = chrome.i18n.getMessage('overlayDismiss') || 'Đóng';
    const extensionName = chrome.i18n.getMessage('extensionName') || 'FPTU Study Calendar';
    
    activeScrapingTabs.set(attendanceTab.id, {
      title: overlayTitle,
      message: overlayMessage,
      dismissText: dismissText,
      extensionName: extensionName
    });
    
    // Store overlay state in sessionStorage for persistence across page reloads
    await chrome.scripting.executeScript({
      target: { tabId: attendanceTab.id },
      func: (title, message, dismissText, extensionName) => {
        sessionStorage.setItem('fptu_scraping_active', 'true');
        sessionStorage.setItem('fptu_overlay_title', title);
        sessionStorage.setItem('fptu_overlay_message', message);
        sessionStorage.setItem('fptu_overlay_dismiss', dismissText);
        sessionStorage.setItem('fptu_extension_name', extensionName);
        sessionStorage.setItem('fptu_scraping_progress', '');
      },
      args: [overlayTitle, overlayMessage, dismissText, extensionName]
    });
    
    await injectMinimalOverlay(attendanceTab.id, overlayTitle, overlayMessage,
      dismissText, '', extensionName);
    
    // Step 7: Extract schedule for each course
    let processedCount = 0;

    // Always process the current course first (the page we are already on)
    const currentCourse = courses.find(c => c.isCurrent);
    if (currentCourse) {
      try {
        const scheduleRows = await extractAttendanceTable(attendanceTab.id, currentCourse.code);
        const classes = normalizeAttendanceData(scheduleRows, currentCourse, semesterName);
        allClasses.push(...classes);
        processedCount++;

        const progressText = chrome.i18n.getMessage('fastModeProgress', [
          processedCount.toString(),
          courses.length.toString()
        ]) || `Đang tải môn ${processedCount}/${courses.length}`;

        console.log(`Fast mode progress (current course ${currentCourse.code}): ${progressText} [${processedCount}/${courses.length}]`);

        // Update sessionStorage for persistence across page loads
        await chrome.scripting.executeScript({
          target: { tabId: attendanceTab.id },
          func: (progress) => {
            sessionStorage.setItem('fptu_scraping_progress', progress);
          },
          args: [progressText]
        });

        try {
          chrome.runtime.sendMessage({
            action: 'progressUpdate',
            currentCourse: processedCount,
            totalCourses: courses.length
          }).catch(() => {});
        } catch (e) {}
      } catch (error) {
        console.error(`Error processing course ${currentCourse.code}:`, error);
        errors.push({ course: currentCourse.code, error: error.message });
      }
    }

    // Process remaining courses (navigate as needed)
    for (const course of courses.filter(c => !c.isCurrent)) {
      try {
        // Calculate progress BEFORE navigation so we can show it during page load
        const nextProgress = processedCount + 1;
        const progressText = chrome.i18n.getMessage('fastModeProgress', [
          nextProgress.toString(),
          courses.length.toString()
        ]) || `Đang tải môn ${nextProgress}/${courses.length}`;
        
        console.log(`Fast mode: navigating to course ${course.code} [${nextProgress}/${courses.length}]`);
        
        // IMPORTANT: Update sessionStorage BEFORE navigation (so overlay shows correct progress after reload)
        await chrome.scripting.executeScript({
          target: { tabId: attendanceTab.id },
          func: (progress) => {
            sessionStorage.setItem('fptu_scraping_progress', progress);
          },
          args: [progressText]
        });
        
        if (course.url) {
          await navigateToUrl(attendanceTab.id, `${ATTENDANCE_URL}${course.url}`, WAIT_TIMES.COURSE_NAVIGATION);
          // Overlay is automatically re-injected by chrome.tabs.onUpdated listener
          // It will read progress from sessionStorage
        }

        const scheduleRows = await extractAttendanceTable(attendanceTab.id, course.code);
        const classes = normalizeAttendanceData(scheduleRows, course, semesterName);
        allClasses.push(...classes);
        processedCount++;
        
        console.log(`Fast mode progress: extracted ${classes.length} classes from ${course.code} [${processedCount}/${courses.length}]`);

        try {
          chrome.runtime.sendMessage({
            action: 'progressUpdate',
            currentCourse: processedCount,
            totalCourses: courses.length
          }).catch(() => {});
        } catch (e) {}
      } catch (error) {
        console.error(`Error processing remaining course ${course.code}:`, error);
        errors.push({ course: course.code, error: error.message });
      }
    }

    console.log(`Fast mode: finished processing all ${processedCount}/${courses.length} courses with ${allClasses.length} total classes`);
    scrapingSuccessful = true;
    
    // Completion
    const completeText = chrome.i18n.getMessage('fastModeComplete', [
      allClasses.length.toString()
    ]) || `Đã tải ${allClasses.length} buổi học`;
    
    console.log(`Fast mode: showing completion message: ${completeText}`);
    
    // Update overlay to show completion (directly manipulate DOM since content.js is not loaded)
    await chrome.scripting.executeScript({
      target: { tabId: attendanceTab.id },
      func: (completeText) => {
        const overlay = document.getElementById('fptu-calendar-overlay');
        if (overlay) {
          overlay.classList.add('complete');
          const progressEl = overlay.querySelector('.overlay-progress');
          const spinnerEl = overlay.querySelector('.spinner');
          const dismissButton = overlay.querySelector('#overlay-dismiss');
          
          if (progressEl) {
            progressEl.textContent = completeText;
            progressEl.style.color = '#10b981';
            progressEl.style.fontWeight = '600';
          }
          if (spinnerEl) {
            spinnerEl.style.display = 'none';
          }
          if (dismissButton) {
            dismissButton.style.display = 'block';
          }
          
          console.log('Overlay updated to show completion');
        } else {
          console.log('Overlay not found when trying to show completion');
        }
      },
      args: [completeText]
    }).catch((error) => {
      console.log(`Failed to update overlay to completion state: ${error.message}`);
    });
    
    // Wait for user to dismiss manually (overlay will be removed when user clicks dismiss button)
    // Just mark scraping as complete and remove from active tabs
    activeScrapingTabs.delete(attendanceTab.id);
    
    return {
      success: true,
      data: { classes: allClasses },
      mode: 'fast',
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error('Fast mode scraping error:', error);
    
    if (attendanceTab) {
      // Clear scraping state from sessionStorage and hide overlay
      await chrome.scripting.executeScript({
        target: { tabId: attendanceTab.id },
        func: () => {
          sessionStorage.removeItem('fptu_scraping_active');
          sessionStorage.removeItem('fptu_overlay_title');
          sessionStorage.removeItem('fptu_overlay_message');
          sessionStorage.removeItem('fptu_overlay_dismiss');
          sessionStorage.removeItem('fptu_extension_name');
          sessionStorage.removeItem('fptu_scraping_progress');
          
          // Remove overlay
          const overlay = document.getElementById('fptu-calendar-overlay');
          if (overlay) {
            overlay.remove();
          }
        }
      }).catch(() => {});
      
      activeScrapingTabs.delete(attendanceTab.id);
    }
    
    // Map technical error codes to friendly, localized messages
    const errorCode = error?.message || 'UNKNOWN';
    const friendlyMessages = {
      'NO_COURSES': chrome.i18n.getMessage('errorNoCoursesFound') || 'Không tìm thấy môn học trong kỳ này.',
      'NOT_LOGGED_IN': chrome.i18n.getMessage('errorNotLoggedIn') || 'Bạn chưa đăng nhập vào FAP. Vui lòng đăng nhập và thử lại.',
      'ATTENDANCE_UNAVAILABLE': chrome.i18n.getMessage('errorAttendanceUnavailable') || 'Không thể truy cập trang điểm danh.',
      'PARSE_FAILED': chrome.i18n.getMessage('errorParseFailed') || 'Lỗi xử lý dữ liệu từ trang.',
      'NETWORK': chrome.i18n.getMessage('errorNetwork') || 'Lỗi kết nối mạng.',
      'UNKNOWN': chrome.i18n.getMessage('errorUnknown') || 'Lỗi không xác định.'
    };
    const errorMessage = friendlyMessages[errorCode] || friendlyMessages['UNKNOWN'];
    
    return {
      success: false,
      error: errorCode,
      errorMessage,
      mode: 'fast'
    };
  } finally {
    if (shouldCloseTab && attendanceTab && !scrapingSuccessful) {
      try {
        await chrome.tabs.remove(attendanceTab.id);
      } catch (e) {
        console.log('Tab cleanup failed:', e.message);
      }
    }
  }
}

// ========================================
// STORAGE: UPDATE MERGE LOGIC FOR MODES
// ========================================

/**
 * Merge classes with mode awareness
 * Newer data always wins, even if it has less information
 */
function mergeClassesData(existingClasses, newClasses) {
  const merged = [...existingClasses];
  
  newClasses.forEach(newClass => {
    const existingIdx = merged.findIndex(c => 
      // Match on activityId if both have it, otherwise match on date+subject+time
      (c.activityId === newClass.activityId) ||
      (c.date === newClass.date && 
       c.subjectCode === newClass.subjectCode &&
       c.time?.start === newClass.time?.start &&
       c.time?.end === newClass.time?.end)
    );
    
    if (existingIdx >= 0) {
      // Merge: newer wins, but keep richer fields from existing if new is missing/null
      const existingClass = merged[existingIdx];
      const mergedClass = { ...existingClass };

      // Apply new fields, but only overwrite when new has a value
      Object.keys(newClass).forEach((key) => {
        const incoming = newClass[key];
        if (incoming !== undefined && incoming !== null) {
          mergedClass[key] = incoming;
        }
      });

      merged[existingIdx] = mergedClass;
      console.log(`Merged/replaced class: ${newClass.subjectCode} on ${newClass.date}`);
    } else {
      merged.push(newClass);
    }
  });
  
  return merged;
}

/**
 * Save scraped classes with proper flattening for both modes
 */
async function saveScrapedClasses(weeksData, mergeMode = false, mode) {
  try {
    // Handle both fast mode (direct classes array) and detailed mode (weeks structure)
    let newClasses = [];
    
    if (weeksData.classes) {
      // Fast mode: direct classes array
      newClasses = weeksData.classes;
    } else if (weeksData.weeks) {
      // Detailed mode: flatten weeks
      newClasses = flattenWeeksToClasses(weeksData);
    }
    
    if (mergeMode) {
      const existing = await chrome.storage.local.get(['scrapedClasses']);
      const existingClasses = existing.scrapedClasses || [];
      const mergedClasses = mergeClassesData(existingClasses, newClasses);
      await chrome.storage.local.set({
        scrapedClasses: mergedClasses,
        // Track the mode used for this scrape so the merge dialog can warn on differences
        lastScrapeMode: mode || existing.lastScrapeMode || null
      });
      console.log(`Merged ${newClasses.length} classes with ${existingClasses.length} existing. Total: ${mergedClasses.length}`);
    } else {
      await chrome.storage.local.set({
        scrapedClasses: newClasses,
        lastScrapeMode: mode || null
      });
      console.log(`Saved ${newClasses.length} classes (replaced existing)`);
    }
  } catch (error) {
    console.error('Error saving scraped classes:', error);
  }
}

// Reset first run flag on browser startup (service worker may have been terminated)
chrome.runtime.onStartup.addListener(async () => {
  await resetFirstRunFlag();
  console.log('Reset first run flag on browser startup');
});

chrome.runtime.onInstalled.addListener(async (details) => {
  // Reset first run flag on install or update
  await resetFirstRunFlag();
  console.log('Reset first run flag on install/update');
  // Note: Data is now persisted across sessions and updates
});

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.action);
  
  // Handle ping for testing
  if (message.action === 'ping') {
    sendResponse({ pong: true });
    return false;
  }
  
  // Get semesters list for fast mode
  if (message.action === 'getSemestersList') {
    (async () => {
      try {
        // Check cache first
        const cached = await getCachedSemesters();
        if (cached) {
          sendResponse({ success: true, semesters: cached.semesters, fromCache: true });
          return;
        }
        
        // Fetch fresh
        let tab = await findExistingFAPTab();
        let shouldClose = false;
        
        if (!tab) {
          tab = await chrome.tabs.create({ url: ATTENDANCE_URL, active: false });
          shouldClose = true;
          await new Promise(r => setTimeout(r, 2000));
        }
        
        // Check login
        const isLoggedIn = await checkLogin(tab.id);
        if (!isLoggedIn) {
          if (shouldClose) await chrome.tabs.remove(tab.id);
          sendResponse({ success: false, error: 'NOT_LOGGED_IN' });
          return;
        }
        
        await navigateToAttendancePage(tab.id);
        const semesters = await extractSemestersFromAttendance(tab.id);
        
        // Cache results
        await setCachedSemesters(semesters);
        
        if (shouldClose) {
          await chrome.tabs.remove(tab.id);
        }
        
        sendResponse({ success: true, semesters, fromCache: false });
      } catch (error) {
        console.error('Error getting semesters:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  // Invalidate cache
  if (message.action === 'invalidateCache') {
    (async () => {
      await invalidateCache();
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (message.action === 'startScraping') {
    console.log('Starting scraping process...');
    
    // Track if response has been sent to avoid calling sendResponse multiple times
    let responseSent = false;
    
    // Helper function to safely send response
    // Prevents calling sendResponse multiple times and handles closed channels gracefully
    const safeSendResponse = (response) => {
      if (responseSent) {
        console.log('Response already sent, skipping duplicate response');
        return;
      }
      
      try {
        sendResponse(response);
        responseSent = true;
      } catch (e) {
        // Channel already closed (e.g., popup was closed) or other error
        // This is expected behavior when user closes popup during scraping
        console.log('Cannot send response (channel may be closed):', e.message);
        responseSent = true; // Mark as sent to prevent retries
      }
    };
    
    // Route based on mode
    if (message.mode === 'fast') {
      // Fast mode
      startScrapingFastMode(message.semesterId, message.waitTime)
        .then(async (result) => {
          console.log('Fast mode scraping completed:', result);
          if (result.success && result.data) {
            const mergeMode = message.mergeMode === true;
            await saveScrapedClasses(result.data, mergeMode, 'fast');
          }
          safeSendResponse(result);
        })
        .catch((error) => {
          console.error('Fast mode scraping error:', error);
          safeSendResponse({
            success: false,
            error: error.message,
            mode: 'fast'
          });
        });
    } else {
      // Detailed mode (existing logic)
      startScraping(message.startDate, message.endDate, message.waitTime)
        .then(async (result) => {
          console.log('Detailed mode scraping completed:', result);
          if (result.success && result.data) {
            console.log('Scraped data (JSON):', JSON.stringify(result.data, null, 2));
            const mergeMode = message.mergeMode === true;
            await saveScrapedClasses(result.data, mergeMode, 'detailed');
          }
          if (result.errors && result.errors.length > 0) {
            console.log('Failed weeks:', result.errors);
          }
          safeSendResponse(result);
        })
        .catch((error) => {
          console.error('Detailed mode scraping error:', error);
          safeSendResponse({
            success: false,
            error: error.message,
            mode: 'detailed'
          });
        });
    }
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'progressUpdate') {
    // Forward progress updates to all popup windows
    chrome.runtime.sendMessage(message).catch(() => {});
    return false; // No response needed
  }
  
  return false;
});

