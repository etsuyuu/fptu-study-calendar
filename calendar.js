// Calendar preview page JavaScript

// Internationalization helper
function getMessage(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions);
}

let allClasses = [];
let currentWeekStart = null;
let currentEditingClass = null;

// ========================================
// COLOR SYSTEM
// ========================================

/**
 * Color palette for classes
 * Maximum 20 unique classes (10 offline + 10 online)
 * Modern, vibrant colors inspired by Tailwind CSS and Material Design
 */
const CLASS_COLORS = {
  // Offline classes: warm, earthy, approachable colors
  // Using green, emerald, teal, blue families with medium saturation
  offline: [
    '#10b981', // Emerald 500 - fresh green
    '#14b8a6', // Teal 500 - vibrant teal
    '#0d9488', // Teal 600 - deeper teal
    '#059669', // Emerald 600 - rich green
    '#0891b2', // Cyan 600 - clear cyan
    '#0ea5e9', // Sky 500 - bright sky blue
    '#06b6d4', // Cyan 500 - vibrant cyan
    '#0284c7', // Sky 600 - deeper sky
    '#047857', // Emerald 700 - deep green
    '#0c4a6e'  // Sky 800 - deeper sky blue
  ],
  // Online classes: cooler, more saturated colors
  // Using indigo, violet, pink, rose families for clear distinction
  online: [
    '#6366f1', // Indigo 500 - vibrant indigo
    '#8b5cf6', // Violet 500 - rich violet
    '#a855f7', // Purple 500 - bright purple
    '#ec4899', // Pink 500 - vibrant pink
    '#f43f5e', // Rose 500 - energetic rose
    '#f97316', // Orange 500 - warm orange
    '#f59e0b', // Amber 500 - golden amber
    '#3b82f6', // Blue 500 - bright blue
    '#7c3aed', // Violet 600 - deeper violet
    '#d946ef'  // Fuchsia 500 - vivid fuchsia
  ]
};

/**
 * Calculate relative luminance of a color (WCAG formula)
 * @param {string} hex - Hex color code (e.g., '#94a3b8')
 * @returns {number} Luminance value between 0 and 1
 */
function getLuminance(hex) {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // Apply gamma correction
  const toLinear = (val) => {
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  };

  const rLinear = toLinear(r);
  const gLinear = toLinear(g);
  const bLinear = toLinear(b);

  // Calculate relative luminance
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Determine if text should be light or dark based on background color
 * @param {string} bgHex - Background hex color
 * @returns {'light'|'dark'} Text color preference
 * 
 * For dark theme: prefer light text (higher threshold for dark)
 * For light theme: prefer dark text on lighter backgrounds
 */
function getTextColor(bgHex) {
  const isDark = getCurrentTheme() === 'dark';
  const luminance = getLuminance(bgHex);
  
  if (isDark) {
    // Dark theme: use light text unless background is very light
    return luminance > 0.6 ? 'dark' : 'light';
  } else {
    // Light theme: use higher threshold (0.4) to favor dark text on lighter backgrounds
    return luminance > 0.4 ? 'dark' : 'light';
  }
}

/**
 * Get current theme (light or dark)
 * @returns {'light'|'dark'} Current theme
 */
function getCurrentTheme() {
  const root = document.documentElement;
  const themeAttr = root.getAttribute('data-theme');
  if (themeAttr) {
    return themeAttr;
  }
  // Check system preference if no explicit theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Create a tinted version of a color for event card backgrounds
 * Light theme: very light tint (92% white blend) for dark text
 * Dark theme: darker tint (85% dark blend) for light text
 * @param {string} baseColor - Base hex color
 * @param {boolean} isOnline - Whether class is online
 * @returns {string} Tinted background color hex
 */
function getTintedBackground(baseColor, isOnline) {
  const isDark = getCurrentTheme() === 'dark';
  
  // Convert hex to RGB
  const r = parseInt(baseColor.slice(1, 3), 16);
  const g = parseInt(baseColor.slice(3, 5), 16);
  const b = parseInt(baseColor.slice(5, 7), 16);
  
  if (isDark) {
    // Dark theme: create a darker tint on neutral charcoal base (#262626)
    const darkBaseR = 38;
    const darkBaseG = 38;
    const darkBaseB = 38;
    const tintFactor = 0.85;
    
    // Blend with color at reduced saturation for dark theme
    const colorMix = 0.15; // 15% of original color
    const tintedR = Math.round(r * colorMix + darkBaseR * tintFactor);
    const tintedG = Math.round(g * colorMix + darkBaseG * tintFactor);
    const tintedB = Math.round(b * colorMix + darkBaseB * tintFactor);
    
    return `#${tintedR.toString(16).padStart(2, '0')}${tintedG.toString(16).padStart(2, '0')}${tintedB.toString(16).padStart(2, '0')}`;
  } else {
    // Light theme: create a very light tint (92% white blend) for backgrounds
    // This ensures dark text is readable while preserving color identity
    const tintFactor = 0.92;
    const tintedR = Math.round(r * (1 - tintFactor) + 255 * tintFactor);
    const tintedG = Math.round(g * (1 - tintFactor) + 255 * tintFactor);
    const tintedB = Math.round(b * (1 - tintFactor) + 255 * tintFactor);
    
    return `#${tintedR.toString(16).padStart(2, '0')}${tintedG.toString(16).padStart(2, '0')}${tintedB.toString(16).padStart(2, '0')}`;
  }
}

/**
 * Assign a consistent color to a class based on its subject code
 * Same subject code will always get the same color
 * @param {string} subjectCode - Class subject code
 * @param {boolean} isOnline - Whether class is online
 * @returns {string} Hex color code
 */
function getClassColor(subjectCode, isOnline) {
  const palette = isOnline ? CLASS_COLORS.online : CLASS_COLORS.offline;
  
  // Simple hash function for consistent color assignment
  let hash = 0;
  for (let i = 0; i < subjectCode.length; i++) {
    const char = subjectCode.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Map hash to palette index
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

// Update export button state based on data availability
function updateExportButtonState() {
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.disabled = allClasses.length === 0;
  }
}

// Load classes from storage
async function loadClasses() {
  try {
    const result = await chrome.storage.local.get(['scrapedClasses']);
    if (result.scrapedClasses) {
      allClasses = result.scrapedClasses;
      renderCalendar();
    } else {
      allClasses = [];
      showEmptyState();
    }
    updateExportButtonState();
  } catch (error) {
    console.error('Error loading classes:', error);
    allClasses = [];
    showEmptyState();
    updateExportButtonState();
  }
}

// Save classes to storage
async function saveClasses() {
  try {
    await chrome.storage.local.set({ scrapedClasses: allClasses });
  } catch (error) {
    console.error('Error saving classes:', error);
  }
}

// Parse ISO date string (YYYY-MM-DD) as local timezone date
// Avoids timezone shift issues with new Date(dateStr) which parses as UTC
function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Get week start date (Monday)
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

// Format date for display
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Get classes for a specific week
function getClassesForWeek(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  // Normalize dates to start of day for comparison
  const weekStartNormalized = new Date(weekStart);
  weekStartNormalized.setHours(0, 0, 0, 0);
  const weekEndNormalized = new Date(weekEnd);
  weekEndNormalized.setHours(23, 59, 59, 999);
  
  return allClasses.filter(cls => {
    const classDate = parseLocalDate(cls.date);
    classDate.setHours(0, 0, 0, 0);
    
    // Only include classes that fall within the exact week date range (including year)
    return classDate >= weekStartNormalized && classDate <= weekEndNormalized;
  });
}

// Get all weeks that contain classes
function getAllWeeksWithClasses() {
  if (allClasses.length === 0) return [];
  
  const weekStarts = new Set();
  allClasses.forEach(cls => {
    const classDate = parseLocalDate(cls.date);
    const weekStart = getWeekStart(classDate);
    // Format as local date to avoid timezone shift from toISOString()
    const year = weekStart.getFullYear();
    const month = String(weekStart.getMonth() + 1).padStart(2, '0');
    const day = String(weekStart.getDate()).padStart(2, '0');
    weekStarts.add(`${year}-${month}-${day}`);
  });
  
  return Array.from(weekStarts)
    .map(dateStr => parseLocalDate(dateStr))
    .sort((a, b) => a - b);
}

// Format week for selector
function formatWeekForSelector(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
}

// Calculate time position in grid (minutes from 7:00)
function getTimePosition(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const totalMinutes = (hours * 60 + minutes) - (7 * 60); // Offset from 7:00
  return totalMinutes; // Return in minutes
}

// Calculate block height (in minutes)
function getBlockHeight(startTime, endTime) {
  const start = getTimePosition(startTime);
  const end = getTimePosition(endTime);
  return end - start; // Return in minutes
}

// Render week view
function renderWeekView() {
  if (!currentWeekStart) {
    const todayWeek = getWeekStart(new Date());
    const allWeeks = getAllWeeksWithClasses();

    if (allWeeks.length > 0) {
      // Format both dates as local dates to avoid timezone shift
      const todayWeekStr = `${todayWeek.getFullYear()}-${String(todayWeek.getMonth() + 1).padStart(2, '0')}-${String(todayWeek.getDate()).padStart(2, '0')}`;
      const todayMatch = allWeeks.find(week => {
        const weekStr = `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, '0')}-${String(week.getDate()).padStart(2, '0')}`;
        return weekStr === todayWeekStr;
      });
      // Always call getWeekStart to ensure result is a Monday
      currentWeekStart = getWeekStart(todayMatch || allWeeks[0]);
    } else {
      currentWeekStart = todayWeek;
    }
  }

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  
  // Update week selector
  const weekSelector = document.getElementById('weekSelector');
  const allWeeks = getAllWeeksWithClasses();
  
  // If no classes, add current week
  if (allWeeks.length === 0) {
    allWeeks.push(currentWeekStart);
  }
  
  weekSelector.innerHTML = '';
  allWeeks.forEach(weekStart => {
    const option = createElement('option', '', formatWeekForSelector(weekStart));
    option.value = weekStart.toISOString().split('T')[0];
    if (weekStart.toISOString().split('T')[0] === currentWeekStart.toISOString().split('T')[0]) {
      option.selected = true;
    }
    weekSelector.appendChild(option);
  });

  const weekClasses = getClassesForWeek(currentWeekStart);
  console.log('Current week start:', currentWeekStart);
  console.log('Week classes found:', weekClasses.length);
  console.log('All classes:', allClasses.length);
  
  const grid = document.getElementById('weekGrid');
  grid.innerHTML = '';

  // Create slot labels (Slot 0 to Slot 12)
  const slots = [];
  for (let slot = 0; slot <= 12; slot++) {
    slots.push(`Slot ${slot}`);
  }

  // Create grid structure
  // Header row (row 1)
  // Add empty cell in first column (above slot labels)
  const emptyHeaderCell = createElement('div', 'time-slot', '');
  emptyHeaderCell.style.gridRow = 1;
  emptyHeaderCell.style.gridColumn = 1;
  grid.appendChild(emptyHeaderCell);
  
  // Add day headers
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (let i = 0; i < 7; i++) {
    const day = new Date(currentWeekStart);
    day.setDate(day.getDate() + i);
    day.setHours(0, 0, 0, 0);
    
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const dayName = dayNames[day.getDay()];
    const dayHeader = createElement('div', 'day-header', '');
    
    // Check if this is today
    if (day.getTime() === today.getTime()) {
      dayHeader.classList.add('today');
    }
    
    const dayNameEl = createElement('div', 'day-header-name', dayName);
    const dayDateEl = createElement('div', 'day-header-date', formatDate(day));
    
    dayHeader.appendChild(dayNameEl);
    dayHeader.appendChild(dayDateEl);
    grid.appendChild(dayHeader);
  }
  
  // Update header subtitle with week range
  const subtitleEl = document.getElementById('headerSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${formatDate(currentWeekStart)} - ${formatDate(weekEnd)}`;
  }

  // Track which slots have classes
  const slotsWithClasses = new Set();
  weekClasses.forEach(cls => {
    if (cls.slot !== undefined && cls.slot !== null && cls.slot >= 0 && cls.slot <= 12) {
      slotsWithClasses.add(cls.slot);
    }
  });

  // Create slot rows (Slot 0 to Slot 12 = 13 rows, starting at row 2)
  slots.forEach((slotLabel, slotIndex) => {
    const hasClasses = slotsWithClasses.has(slotIndex);
    const gridRow = slotIndex + 2; // Start at row 2 (after header row)
    
    // Slot label
    const slotLabelEl = createElement('div', 'time-slot', slotLabel);
    slotLabelEl.id = `slot-label-${slotIndex}`;
    slotLabelEl.dataset.slot = slotIndex;
    if (hasClasses) {
      slotLabelEl.classList.add('has-classes');
    }
    slotLabelEl.style.gridRow = gridRow;
    slotLabelEl.style.gridColumn = 1;
    grid.appendChild(slotLabelEl);
    
    // Day cells for this slot
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayCell = createElement('div', 'day-cell', '');
      dayCell.dataset.day = dayIndex;
      dayCell.dataset.slot = slotIndex;
      dayCell.id = `day-cell-${dayIndex}-slot-${slotIndex}`;
      dayCell.style.gridRow = gridRow;
      dayCell.style.gridColumn = dayIndex + 2;
      grid.appendChild(dayCell);
    }
  });

  // Add class blocks - place them in the correct slot cell
  weekClasses.forEach(cls => {
    const classDate = parseLocalDate(cls.date);
    classDate.setHours(0, 0, 0, 0);
    const weekStartDate = new Date(currentWeekStart);
    weekStartDate.setHours(0, 0, 0, 0);
    
    // Calculate day index - use exact date matching (including year)
    let dayIndex = -1;
    
    // Find which day of the week this class belongs to by comparing full dates
    for (let i = 0; i < 7; i++) {
      const weekDay = new Date(weekStartDate);
      weekDay.setDate(weekDay.getDate() + i);
      weekDay.setHours(0, 0, 0, 0);
      
      // Compare full dates (year, month, day) to ensure correct placement
      if (weekDay.getTime() === classDate.getTime()) {
        dayIndex = i;
        break;
      }
    }
    
    console.log('Processing class:', cls.subjectCode, 'date:', cls.date, 'dayIndex:', dayIndex, 'slot:', cls.slot);
    
    if (dayIndex >= 0 && dayIndex < 7 && cls.slot !== undefined && cls.slot !== null) {
      const slotIndex = cls.slot;
      if (slotIndex >= 0 && slotIndex <= 12) {
        const dayCell = document.getElementById(`day-cell-${dayIndex}-slot-${slotIndex}`);
        if (dayCell) {
          // Mark cell as having classes
          dayCell.classList.add('has-classes');
          
          // Also mark the slot label as having classes
          const slotLabel = document.getElementById(`slot-label-${slotIndex}`);
          if (slotLabel) {
            slotLabel.classList.add('has-classes');
          }
          
          const block = createClassBlock(cls);
          dayCell.appendChild(block);
          console.log('Added class to cell:', `day-cell-${dayIndex}-slot-${slotIndex}`);
        } else {
          console.warn('Day cell not found:', `day-cell-${dayIndex}-slot-${slotIndex}`);
        }
      } else {
        console.warn('Invalid slot index:', slotIndex);
      }
    } else {
      console.warn('Invalid dayIndex or slot:', dayIndex, cls.slot);
    }
  });
}

// Create class block element
function createClassBlock(cls) {
  const block = createElement('div', `class-block ${cls.isOnline ? 'online' : 'offline'}`, '');
  block.dataset.classId = cls.activityId;
  
  // Get assigned base color for this class
  const baseColor = getClassColor(cls.subjectCode, cls.isOnline);
  
  // Use tinted background for better readability with dark text
  // This creates a soft tinted background with a stronger accent border
  const bgColor = getTintedBackground(baseColor, cls.isOnline);
  const textColor = getTextColor(bgColor);
  
  // Apply colors via inline styles for dynamic assignment
  // Use tinted background with strong accent border
  block.style.backgroundColor = bgColor;
  block.style.borderLeftColor = baseColor;
  block.style.borderLeftWidth = '4px';
  block.style.borderLeftStyle = 'solid';
  block.style.color = textColor === 'light' ? '#ffffff' : 'var(--color-text-primary)';
  block.style.setProperty('--base-color', baseColor);
  
  // Add data attribute for CSS targeting and store base color for accents
  block.dataset.textColor = textColor;
  block.dataset.baseColor = baseColor;
  
  const timeStr = `${cls.time.start} - ${cls.time.end}`;
  
  // Build badge group (Online + Relocated)
  let badgesHtml = '';
  if (cls.isOnline === true || cls.isRelocated === true) {
    badgesHtml = '<div class="class-badges">';
    if (cls.isOnline === true) {
      badgesHtml += `<span class="class-badge class-badge-online">● Online</span>`;
    }
    if (cls.isRelocated === true) {
      badgesHtml += `<span class="class-badge class-badge-relocated">${getMessage('classRelocated')}</span>`;
    }
    badgesHtml += '</div>';
  }
  
  // Build links section (Materials, Meet, and EduNext) - will be pushed to bottom via flexbox
  // Materials link is always first (leftmost)
  let linksHtml = '';
  if (cls.materialsUrl) {
    linksHtml += `<a href="${cls.materialsUrl}" target="_blank" class="class-link" onclick="event.stopPropagation();">📄 ${getMessage('classMaterials')}</a>`;
  }
  if (cls.meetUrl) {
    if (linksHtml) linksHtml += ' ';
    linksHtml += `<a href="${cls.meetUrl}" target="_blank" class="class-link" onclick="event.stopPropagation();">🔗 Meet</a>`;
  }
  if (cls.edunextUrl) {
    if (linksHtml) linksHtml += ' ';
    linksHtml += `<a href="${cls.edunextUrl}" target="_blank" class="class-link" onclick="event.stopPropagation();">📚 ${getMessage('classEduNext')}</a>`;
  }
  
  block.innerHTML = `
    <div class="class-content">
      <div class="class-header">
        <div class="class-name">${cls.subjectCode}</div>
        ${badgesHtml}
      </div>
      <div class="class-meta">
        <div class="class-location">${cls.location || 'N/A'}</div>
        <div class="class-time">${timeStr}</div>
      </div>
    </div>
    ${linksHtml ? `<div class="class-links">${linksHtml}</div>` : ''}
  `;
  block.addEventListener('click', () => openEditModal(cls));
  return block;
}

// Get filtered classes based on current filter values
function getFilteredClasses() {
  const subjectFilter = document.getElementById('subjectFilter');
  const statusFilter = document.getElementById('statusFilter');
  
  const selectedSubject = subjectFilter ? subjectFilter.value : 'all';
  const selectedStatus = statusFilter ? statusFilter.value : 'all';
  
  let filtered = [...allClasses];
  
  // Filter by subject
  if (selectedSubject !== 'all') {
    filtered = filtered.filter(cls => cls.subjectCode === selectedSubject);
  }
  
  // Filter by online/offline status
  if (selectedStatus !== 'all') {
    if (selectedStatus === 'online') {
      filtered = filtered.filter(cls => cls.isOnline === true);
    } else if (selectedStatus === 'offline') {
      filtered = filtered.filter(cls => cls.isOnline !== true);
    }
  }
  
  return filtered;
}

// Render list view
function renderListView() {
  const listContent = document.getElementById('listContent');
  listContent.innerHTML = '';

  // Get filtered classes
  const filteredClasses = getFilteredClasses();

  if (filteredClasses.length === 0) {
    listContent.innerHTML = `<div class="empty-state">${getMessage('emptyState')}</div>`;
    updateListSidebar([]);
    return;
  }

  // Sort classes by date and time
  const sortedClasses = filteredClasses.sort((a, b) => {
    const dateA = new Date(a.date + 'T' + a.time.start);
    const dateB = new Date(b.date + 'T' + b.time.start);
    return dateA - dateB;
  });

  // Group classes by day
  const classesByDay = {};
  sortedClasses.forEach(cls => {
    const dateKey = cls.date;
    if (!classesByDay[dateKey]) {
      classesByDay[dateKey] = [];
    }
    classesByDay[dateKey].push(cls);
  });

  // Render day groups
  Object.keys(classesByDay).sort().forEach(dateKey => {
    const dayClasses = classesByDay[dateKey];
    const firstClass = dayClasses[0];
    const date = new Date(firstClass.date);
    
    // Get day name in Vietnamese
    const dayNames = [
      getMessage('daySunday'),
      getMessage('dayMonday'),
      getMessage('dayTuesday'),
      getMessage('dayWednesday'),
      getMessage('dayThursday'),
      getMessage('dayFriday'),
      getMessage('daySaturday')
    ];
    const dayName = dayNames[date.getDay()];
    const formattedDate = formatDate(firstClass.date);
    
    // Create day group
    const dayGroup = createElement('div', 'day-group', '');
    const dayHeader = createElement('div', 'day-header', '');
    dayHeader.innerHTML = `
      <span>${dayName}</span>
      <span class="day-header-date">${formattedDate}</span>
    `;
    
    const dayClassesContainer = createElement('div', 'day-classes', '');
    
    dayClasses.forEach(cls => {
      const item = createElement('div', 'class-item', '');
      
      // Get assigned base color for this class
      const baseColor = getClassColor(cls.subjectCode, cls.isOnline);
      
      // Use tinted background for consistency with calendar view
      const bgColor = getTintedBackground(baseColor, cls.isOnline);
      const textColor = getTextColor(bgColor);
      
      // Apply colors via inline styles (consistent with calendar view)
      item.style.backgroundColor = bgColor;
      item.style.borderLeftColor = baseColor;
      item.style.borderLeftWidth = '4px';
      item.style.borderLeftStyle = 'solid';
      item.style.color = textColor === 'light' ? '#ffffff' : 'var(--color-text-primary)';
      item.style.setProperty('--base-color', baseColor);
      item.dataset.textColor = textColor;
      item.dataset.baseColor = baseColor;
      
      const timeStr = `${cls.time.start} - ${cls.time.end}`;
      
      // Build badge group (Online + Relocated) - same as calendar view
      let badgesHtml = '';
      if (cls.isOnline === true || cls.isRelocated === true) {
        badgesHtml = '<div class="class-badges">';
        if (cls.isOnline === true) {
          badgesHtml += `<span class="class-badge class-badge-online">● Online</span>`;
        }
        if (cls.isRelocated === true) {
          badgesHtml += `<span class="class-badge class-badge-relocated">${getMessage('classRelocated')}</span>`;
        }
        badgesHtml += '</div>';
      }
      
      // Build links section (Materials, Meet, and EduNext) - same as calendar view
      let linksHtml = '';
      if (cls.materialsUrl) {
        linksHtml += `<a href="${cls.materialsUrl}" target="_blank" class="class-link" onclick="event.stopPropagation();">📄 ${getMessage('classMaterials')}</a>`;
      }
      if (cls.meetUrl) {
        if (linksHtml) linksHtml += ' ';
        linksHtml += `<a href="${cls.meetUrl}" target="_blank" class="class-link" onclick="event.stopPropagation();">🔗 Meet</a>`;
      }
      if (cls.edunextUrl) {
        if (linksHtml) linksHtml += ' ';
        linksHtml += `<a href="${cls.edunextUrl}" target="_blank" class="class-link" onclick="event.stopPropagation();">📚 ${getMessage('classEduNext')}</a>`;
      }
      
      // Use same structure as calendar view for consistency, optimized for list scanning
      item.innerHTML = `
        <div class="class-content">
          <div class="class-header">
            <div class="class-name">${cls.subjectCode}</div>
            <div class="class-time">${timeStr}</div>
            ${badgesHtml}
          </div>
          <div class="class-meta">
            <div class="class-location">${cls.location || 'N/A'}</div>
          </div>
        </div>
        ${linksHtml ? `<div class="class-links">${linksHtml}</div>` : ''}
      `;
      item.addEventListener('click', () => openEditModal(cls));
      dayClassesContainer.appendChild(item);
    });
    
    dayGroup.appendChild(dayHeader);
    dayGroup.appendChild(dayClassesContainer);
    listContent.appendChild(dayGroup);
  });
  
  // Update sidebar with statistics
  updateListSidebar(sortedClasses);
}

// Update list sidebar with statistics
function updateListSidebar(filteredClasses) {
  // Update total count (for filtered classes)
  const totalCount = filteredClasses.length;
  document.getElementById('totalClassCount').textContent = totalCount;
  
  // Calculate subject counts (for filtered classes - shown in statistics)
  const subjectCounts = {};
  filteredClasses.forEach(cls => {
    if (!subjectCounts[cls.subjectCode]) {
      subjectCounts[cls.subjectCode] = 0;
    }
    subjectCounts[cls.subjectCode]++;
  });
  
  // Render subject counts (for filtered classes)
  const subjectCountsContainer = document.getElementById('subjectCounts');
  subjectCountsContainer.innerHTML = '';
  
  const sortedFilteredSubjects = Object.keys(subjectCounts).sort();
  sortedFilteredSubjects.forEach(subjectCode => {
    const count = subjectCounts[subjectCode];
    const item = createElement('div', 'subject-count-item', '');
    item.innerHTML = `
      <span class="subject-count-code">${subjectCode}</span>
      <span class="subject-count-number">${count}</span>
    `;
    subjectCountsContainer.appendChild(item);
  });
  
  // Update subject filter dropdown (always show all available subjects from allClasses)
  const subjectFilter = document.getElementById('subjectFilter');
  if (subjectFilter) {
    const currentValue = subjectFilter.value;
    
    // Get all unique subjects from allClasses
    const allSubjects = new Set();
    allClasses.forEach(cls => {
      allSubjects.add(cls.subjectCode);
    });
    const sortedAllSubjects = Array.from(allSubjects).sort();
    
    subjectFilter.innerHTML = `<option value="all">${getMessage('filterAll')}</option>`;
    sortedAllSubjects.forEach(subjectCode => {
      const option = createElement('option', '', '');
      option.value = subjectCode;
      option.textContent = subjectCode;
      subjectFilter.appendChild(option);
    });
    
    // Restore previous selection if it still exists
    if (currentValue && (currentValue === 'all' || sortedAllSubjects.includes(currentValue))) {
      subjectFilter.value = currentValue;
    } else {
      subjectFilter.value = 'all';
    }
  }
}

// Render calendar (switch between views)
function renderCalendar() {
  const isWeekView = document.getElementById('weekViewBtn').classList.contains('active');
  if (isWeekView) {
    renderWeekView();
  } else {
    renderListView();
  }
}

// Show empty state - render empty calendar instead of just a message
function showEmptyState() {
  // Set current week to today if not set
  if (!currentWeekStart) {
    currentWeekStart = getWeekStart(new Date());
  }
  // Render calendar (which will show empty grid)
  renderCalendar();
}

// Open edit modal
function openEditModal(cls) {
  currentEditingClass = cls;
  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');

  // Populate form
  document.getElementById('editSubjectCode').value = cls.subjectCode;
  document.getElementById('editDate').value = cls.date;
  document.getElementById('editTimeStart').value = cls.time.start;
  document.getElementById('editTimeEnd').value = cls.time.end;
  document.getElementById('editLocation').value = cls.location || '';
  document.getElementById('editMeetUrl').value = cls.meetUrl || '';
  document.getElementById('editStatus').value = cls.status || 'Not yet';

  modal.classList.add('active');
}

// Close edit modal
function closeEditModal() {
  const modal = document.getElementById('editModal');
  modal.classList.remove('active');
  currentEditingClass = null;
}

// Save edited class
async function saveEditedClass(formData) {
  if (!currentEditingClass) return;

  const index = allClasses.findIndex(c => c.activityId === currentEditingClass.activityId);
  if (index === -1) return;

  // Update class
  allClasses[index] = {
    ...allClasses[index],
    subjectCode: formData.subjectCode,
    date: formData.date,
    time: {
      start: formData.timeStart,
      end: formData.timeEnd
    },
    location: formData.location,
    meetUrl: formData.meetUrl || null,
    edunextUrl: allClasses[index].edunextUrl || null, // Preserve edunextUrl
    materialsUrl: allClasses[index].materialsUrl || null, // Preserve materialsUrl
    isRelocated: allClasses[index].isRelocated || false, // Preserve isRelocated
    status: formData.status,
    isOnline: formData.meetUrl ? true : allClasses[index].isOnline
  };

  await saveClasses();
  renderCalendar();
  closeEditModal();
}

// Delete class
async function deleteClass() {
  if (!currentEditingClass) return;

  if (confirm(getMessage('confirmDeleteClass'))) {
    allClasses = allClasses.filter(c => c.activityId !== currentEditingClass.activityId);
    await saveClasses();
    updateExportButtonState();
    renderCalendar();
    closeEditModal();
  }
}

// Helper function to create element
function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

// Initialize i18n for elements with data-i18n attribute
function initI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      const message = getMessage(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = message;
      } else if (el.tagName === 'OPTION') {
        el.textContent = message;
      } else {
        el.textContent = message;
      }
    }
  });
  
  // Set footer "Made by" text
  const footerMadeByText = document.getElementById('footerMadeByText');
  if (footerMadeByText) {
    footerMadeByText.textContent = getMessage('footerMadeBy');
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Set icon path
  const headerIcon = document.querySelector('.header-icon');
  if (headerIcon && typeof chrome !== 'undefined' && chrome.runtime) {
    headerIcon.src = chrome.runtime.getURL('icons/icon.png');
  }
  
  // Initialize i18n
  initI18n();
  
  // Load and apply theme before rendering
  async function loadTheme() {
    try {
      const result = await chrome.storage.local.get(['theme']);
      const theme = result.theme || 'system';
      applyTheme(theme);
    } catch (error) {
      console.error('Error loading theme:', error);
    }
  }

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

  await loadTheme();
  
  // Initialize i18n for clear data button
  const clearDataBtn = document.getElementById('clearDataBtn');
  const clearDataBtnText = document.getElementById('clearDataBtnText');
  if (clearDataBtnText) {
    clearDataBtnText.textContent = getMessage('clearCalendarData');
  }
  // Set title attribute
  if (clearDataBtn) {
    clearDataBtn.title = getMessage('clearCalendarData');
  }
  
  // Initialize i18n for today button
  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) {
    todayBtn.title = getMessage('today');
  }
  
  // Initialize export button state (will be updated after loadClasses)
  updateExportButtonState();
  
  loadClasses();

  // View toggle
  document.getElementById('weekViewBtn').addEventListener('click', () => {
    document.getElementById('weekViewBtn').classList.add('active');
    document.getElementById('listViewBtn').classList.remove('active');
    document.getElementById('weekView').classList.remove('hidden');
    document.getElementById('listView').classList.remove('active');
    renderWeekView();
  });

  document.getElementById('listViewBtn').addEventListener('click', () => {
    document.getElementById('listViewBtn').classList.add('active');
    document.getElementById('weekViewBtn').classList.remove('active');
    document.getElementById('weekView').classList.add('hidden');
    document.getElementById('listView').classList.add('active');
    renderListView();
  });

  // List view filters
  const subjectFilter = document.getElementById('subjectFilter');
  const statusFilter = document.getElementById('statusFilter');
  
  if (subjectFilter) {
    subjectFilter.addEventListener('change', () => {
      renderListView();
    });
  }
  
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      renderListView();
    });
  }

  // Week navigation
  document.getElementById('prevWeekBtn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderWeekView();
    updateWeekSelector();
  });

  document.getElementById('nextWeekBtn').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderWeekView();
    updateWeekSelector();
  });

  // Week selector
  document.getElementById('weekSelector').addEventListener('change', (e) => {
    currentWeekStart = new Date(e.target.value);
    renderWeekView();
  });

  // Today button - navigate to current week
  document.getElementById('todayBtn').addEventListener('click', () => {
    const today = new Date();
    currentWeekStart = getWeekStart(today);
    renderWeekView();
    updateWeekSelector();
  });

  // Update week selector to reflect current week
  function updateWeekSelector() {
    const weekSelector = document.getElementById('weekSelector');
    const currentWeekValue = currentWeekStart.toISOString().split('T')[0];
    const allWeeks = getAllWeeksWithClasses();
    
    // Check if current week is in the list
    const weekExists = allWeeks.some(w => w.toISOString().split('T')[0] === currentWeekValue);
    
    if (!weekExists) {
      // Add current week to selector if not present
      const option = createElement('option', '', formatWeekForSelector(currentWeekStart));
      option.value = currentWeekValue;
      option.selected = true;
      weekSelector.appendChild(option);
      
      // Sort options
      const options = Array.from(weekSelector.options);
      options.sort((a, b) => new Date(a.value) - new Date(b.value));
      weekSelector.innerHTML = '';
      options.forEach(opt => weekSelector.appendChild(opt));
      weekSelector.value = currentWeekValue;
    } else {
      weekSelector.value = currentWeekValue;
    }
  }

  // Edit form
  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = {
      subjectCode: document.getElementById('editSubjectCode').value,
      date: document.getElementById('editDate').value,
      timeStart: document.getElementById('editTimeStart').value,
      timeEnd: document.getElementById('editTimeEnd').value,
      location: document.getElementById('editLocation').value,
      meetUrl: document.getElementById('editMeetUrl').value,
      status: document.getElementById('editStatus').value
    };
    await saveEditedClass(formData);
  });

  document.getElementById('deleteBtn').addEventListener('click', deleteClass);
  document.getElementById('cancelBtn').addEventListener('click', closeEditModal);

  // Export button handler
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      // Get classes from storage (all classes, not filtered)
      const result = await chrome.storage.local.get(['scrapedClasses']);
      const classes = result.scrapedClasses || [];
      
      if (classes.length === 0) {
        alert(getMessage('emptyState') + '. ' + getMessage('emptyStateExtractFirst'));
        return;
      }
      
      // Export to ICS
      exportToIcs(classes);
      
      // Show brief success message (optional - could add a toast notification)
      console.log(`Exported ${classes.length} classes to ICS file`);
    } catch (error) {
      console.error('Export error:', error);
      alert(getMessage('errorExportFailed', [error.message]));
    }
  });

  // Clear data button handler
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    // Show confirmation dialog with localized message
    const confirmed = confirm(getMessage('confirmClearCalendarData'));
    
    if (!confirmed) {
      return;
    }
    
    try {
      // Clear data from storage
      await chrome.storage.local.remove(['scrapedClasses']);
      
      // Clear local state
      allClasses = [];
      currentWeekStart = null;
      
      // Show empty state
      showEmptyState();
      
      // Update export button state
      updateExportButtonState();
      
      console.log('All calendar data cleared');
    } catch (error) {
      console.error('Error clearing calendar data:', error);
      alert(getMessage('errorClearDataFailed', [error.message]));
    }
  });

  // Close modal on background click
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') {
      closeEditModal();
    }
  });

  // Theme change handler (called from message listener or system theme change)
  function handleThemeChange(theme) {
    applyTheme(theme);
    // Re-render calendar to apply new theme colors
    if (allClasses.length > 0) {
      renderCalendar();
    }
  }

  // Listen for theme changes from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'themeChanged') {
      handleThemeChange(message.theme);
      sendResponse({ success: true });
    }
    return true;
  });

  // Listen for system theme changes when system theme is selected
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const result = await chrome.storage.local.get(['theme']);
    if (result.theme === 'system' || !result.theme) {
      handleThemeChange('system');
    }
  });
});

