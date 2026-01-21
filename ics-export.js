// ICS (iCalendar) export utility for FPTU Study Calendar
// Compatible with Google Calendar, Apple Calendar, and other major calendar applications

/**
 * Internationalization helper for ICS export
 * @param {string} key - Message key
 * @returns {string} Localized message
 */
function getIcsMessage(key) {
  // Use chrome.i18n if available (in extension context)
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    return chrome.i18n.getMessage(key) || key;
  }
  // Fallback to English for testing outside extension context
  const fallbacks = {
    'icsLocationLabel': 'Location',
    'icsRelocatedWarning': '⚠️ This class has been relocated',
    'icsSummaryRelocated': 'Relocated',
    'icsMeetLabel': 'Google Meet',
    'icsHasEduNext': '* Has discussion on EduNext',
    'icsHasMaterials': '* Has materials on FLM',
    'icsViewLinksNote': '(Please check schedule on FAP to see the links)'
  };
  return fallbacks[key] || key;
}

/**
 * Escape text for ICS format (RFC 5545)
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeIcsText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/;/g, '\\;')    // Escape semicolons
    .replace(/,/g, '\\,')    // Escape commas
    .replace(/\n/g, '\\n')   // Escape newlines
    .replace(/\r/g, '');     // Remove carriage returns
}

/**
 * Fold long lines according to RFC 5545 (max 75 octets per line)
 * Lines longer than 75 characters are folded with CRLF + space
 * @param {string} line - Line to fold
 * @returns {string} Folded line(s)
 */
function foldIcsLine(line) {
  if (!line) return '';
  
  // RFC 5545: Lines must not exceed 75 octets
  const MAX_LINE_LENGTH = 75;
  
  // If line is already short enough, return as-is
  if (line.length <= MAX_LINE_LENGTH) {
    return line;
  }
  
  // Don't fold lines that are already folded (contain CRLF)
  // Just verify each segment is within limits
  if (line.includes('\r\n')) {
    const segments = line.split('\r\n');
    const validSegments = [];
    for (const seg of segments) {
      // Remove leading space from continuation lines before checking
      const isContinuation = seg.startsWith(' ');
      const content = isContinuation ? seg.substring(1) : seg;
      if (content.length <= MAX_LINE_LENGTH) {
        validSegments.push(seg);
      } else {
        // This segment is too long, fold it (without recursion to avoid infinite loop)
        const chunks = [];
        let pos = 0;
        const len = content.length;
        if (!isContinuation) {
          chunks.push(content.substring(0, Math.min(MAX_LINE_LENGTH, len)));
          pos = MAX_LINE_LENGTH;
        }
        while (pos < len) {
          const remaining = len - pos;
          const contLen = Math.min(remaining, MAX_LINE_LENGTH - 1);
          chunks.push(' ' + content.substring(pos, pos + contLen));
          pos += contLen;
        }
        validSegments.push(...chunks);
      }
    }
    return validSegments.join('\r\n');
  }
  
  // Split line into chunks
  // First line: up to 75 characters
  // Continuation lines: space (1 char) + up to 74 content chars = 75 total
  const chunks = [];
  let position = 0;
  const totalLength = line.length;
  
  // First chunk: up to 75 characters
  chunks.push(line.substring(position, Math.min(position + MAX_LINE_LENGTH, totalLength)));
  position += MAX_LINE_LENGTH;
  
  // Continuation chunks: space + up to 74 characters each
  while (position < totalLength) {
    const remaining = totalLength - position;
    const continuationLength = Math.min(remaining, MAX_LINE_LENGTH - 1); // -1 for the leading space
    chunks.push(' ' + line.substring(position, position + continuationLength));
    position += continuationLength;
  }
  
  // Join with CRLF
  return chunks.join('\r\n');
}

/**
 * Format date-time for ICS format (floating time, no timezone)
 * @param {string} dateStr - Date in ISO format (YYYY-MM-DD)
 * @param {string} timeStr - Time in format (HH:mm) - in local time (Vietnam)
 * @returns {string} Formatted date-time string (YYYYMMDDTHHmmss)
 */
function formatIcsDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  
  // Parse date and time (timeStr can be HH:mm or HH:mm:ss)
  const [year, month, day] = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':');
  const hours = Number(timeParts[0]);
  const minutes = Number(timeParts[1]);
  const seconds = timeParts.length > 2 ? Number(timeParts[2]) : 0;
  
  // Format as floating time (no timezone indicator) - this preserves the exact time
  // Times from FAP are in Vietnam local time, so we use floating format
  // Format: YYYYMMDDTHHmmss (no Z suffix = floating time)
  const yearStr = String(year).padStart(4, '0');
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  const hourStr = String(hours).padStart(2, '0');
  const minStr = String(minutes).padStart(2, '0');
  const secStr = String(seconds).padStart(2, '0');
  
  return `${yearStr}${monthStr}${dayStr}T${hourStr}${minStr}${secStr}`;
}

/**
 * Format date-time for ICS format (UTC) - used for DTSTAMP
 * @param {string} dateStr - Date in ISO format (YYYY-MM-DD)
 * @param {string} timeStr - Time in format (HH:mm)
 * @returns {string} Formatted date-time string (YYYYMMDDTHHmmssZ)
 */
function formatIcsDateTimeUtc(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  
  // Parse date and time (timeStr can be HH:mm or HH:mm:ss)
  const [year, month, day] = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':');
  const hours = Number(timeParts[0]);
  const minutes = Number(timeParts[1]);
  const seconds = timeParts.length > 2 ? Number(timeParts[2]) : 0;
  
  // Create date object in UTC
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  
  // Format as UTC: YYYYMMDDTHHmmssZ
  const yearStr = String(date.getUTCFullYear()).padStart(4, '0');
  const monthStr = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dayStr = String(date.getUTCDate()).padStart(2, '0');
  const hourStr = String(date.getUTCHours()).padStart(2, '0');
  const minStr = String(date.getUTCMinutes()).padStart(2, '0');
  const secStr = String(date.getUTCSeconds()).padStart(2, '0');
  
  return `${yearStr}${monthStr}${dayStr}T${hourStr}${minStr}${secStr}Z`;
}

/**
 * Extract base URL from a URL that may contain JWT tokens
 * @param {string} url - Full URL potentially with tokens
 * @returns {string} Base URL without query parameters/tokens
 */
function extractBaseUrl(url) {
  if (!url || !url.trim()) return '';
  try {
    const urlObj = new URL(url.trim());
    // Return only the origin + pathname, without query params or hash
    return urlObj.origin + urlObj.pathname;
  } catch (e) {
    // If URL parsing fails, return empty string
    return '';
  }
}

/**
 * Check if URL contains JWT token (very long query parameters)
 * @param {string} url - URL to check
 * @returns {boolean} True if URL appears to contain JWT token
 */
function hasJwtToken(url) {
  if (!url || !url.trim()) return false;
  try {
    const urlObj = new URL(url.trim());
    // Check if query string is very long (likely contains JWT)
    const queryLength = urlObj.search.length;
    // URLs with JWT tokens typically have query strings > 100 characters
    return queryLength > 100;
  } catch (e) {
    return false;
  }
}

/**
 * Generate a unique UID for an event
 * @param {string} activityId - Activity ID from class data
 * @param {string} dateStr - Date string
 * @param {string} timeStr - Time string
 * @returns {string} Unique identifier
 */
function generateEventUid(activityId, dateStr, timeStr) {
  // Use activityId + date + time for uniqueness
  const uniqueStr = `${activityId || 'class'}-${dateStr}-${timeStr}`;
  // Generate a simple hash-like string
  let hash = 0;
  for (let i = 0; i < uniqueStr.length; i++) {
    const char = uniqueStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Use year + version format to avoid conflicts with previous exports
  const year = new Date().getFullYear();
  return `${year}-v2-${Math.abs(hash)}@fptu-study-calendar`;
}

/**
 * Generate ICS content for a single class event
 * @param {Object} classData - Class data object
 * @param {number} index - Index for sequence number
 * @param {boolean} isFirstClassOfDay - Whether this is the first class of the day
 * @returns {Array<string>} Array of ICS event lines
 */
function generateIcsEvent(classData, index = 0, isFirstClassOfDay = false) {
  const {
    subjectCode,
    date,
    time,
    location,
    isOnline,
    meetUrl,
    edunextUrl,
    materialsUrl,
    isRelocated,
    status,
    activityId
  } = classData;
  
  if (!date || !time || !time.start || !time.end) {
    console.warn('Invalid class data for ICS export:', classData);
    return [];
  }
  
  // Format date-times
  const dtStart = formatIcsDateTime(date, time.start);
  const dtEnd = formatIcsDateTime(date, time.end);
  
  // Validate date-time formatting
  if (!dtStart || !dtEnd) {
    console.warn('Failed to format date-time for class:', classData);
    return [];
  }
  
  // Generate DTSTAMP (current time in UTC)
  const now = new Date();
  const dtStamp = formatIcsDateTimeUtc(
    now.toISOString().split('T')[0],
    String(now.getUTCHours()).padStart(2, '0') + ':' + String(now.getUTCMinutes()).padStart(2, '0') + ':' + String(now.getUTCSeconds()).padStart(2, '0')
  );
  
  // Generate UID
  const uid = generateEventUid(activityId, date, time.start);
  
  // Build summary (title) - required field
  let summary = (subjectCode && subjectCode.trim()) || 'Class';
  if (isOnline) {
    summary += ' (Online)';
  }
  if (isRelocated) {
    summary += ` [${getIcsMessage('icsSummaryRelocated')}]`;
  }
  
  // Build description (avoiding long JWT token URLs)
  const mainParts = [];
  const materialsParts = [];
  
  // Add location with localized label
  if (location && location.trim()) {
    mainParts.push(`${getIcsMessage('icsLocationLabel')}: ${location.trim()}`);
  }
  
  // Status field removed as requested
  
  // Add relocated warning with localized message
  if (isRelocated) {
    mainParts.push(getIcsMessage('icsRelocatedWarning'));
  }
  
  // Add Google Meet link - only include if it doesn't have JWT token
  let hasMeetLink = false;
  if (meetUrl && meetUrl.trim() && !hasJwtToken(meetUrl)) {
    mainParts.push(`${getIcsMessage('icsMeetLabel')}: ${meetUrl.trim()}`);
    hasMeetLink = true;
  } else if (meetUrl && meetUrl.trim()) {
    // If Meet URL has token, use base URL only
    const baseUrl = extractBaseUrl(meetUrl);
    if (baseUrl) {
      mainParts.push(`${getIcsMessage('icsMeetLabel')}: ${baseUrl}`);
      hasMeetLink = true;
    }
  }
  
  // For EduNext and Materials, just add notes instead of links
  // (to avoid JWT token issues and keep description clean)
  if (edunextUrl && edunextUrl.trim()) {
    materialsParts.push(getIcsMessage('icsHasEduNext'));
  }
  
  if (materialsUrl && materialsUrl.trim()) {
    materialsParts.push(getIcsMessage('icsHasMaterials'));
  }
  
  // Add note about viewing links on FAP if we have EduNext or Materials
  if ((edunextUrl && edunextUrl.trim()) || (materialsUrl && materialsUrl.trim())) {
    materialsParts.push(getIcsMessage('icsViewLinksNote'));
  }
  
  // Combine main parts and materials parts with two newlines separator
  const allParts = [];
  if (mainParts.length > 0) {
    allParts.push(...mainParts);
  }
  
  // Add a newline before materials section if there are materials
  if (materialsParts.length > 0) {
    allParts.push(''); // First newline
    allParts.push(...materialsParts);
  }
  
  const description = allParts.length > 0 ? allParts.join('\n') : '';
  
  // Build location string (for LOCATION property)
  let locationStr = (location && location.trim()) || '';
  if (isOnline) {
    // For online classes, just append "(Online)" without the Meet URL
    locationStr = locationStr ? `${locationStr} (Online)` : 'Online';
  }
  
  // Build ICS event - only include required fields and non-empty optional fields
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
  ];
  
  // Add DESCRIPTION only if not empty
  if (description) {
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  }
  
  // Add LOCATION only if not empty
  if (locationStr) {
    lines.push(`LOCATION:${escapeIcsText(locationStr)}`);
  }
  
  lines.push('SEQUENCE:0');
  lines.push('STATUS:CONFIRMED');
  lines.push('TRANSP:OPAQUE'); // BUSY time
  
  // Skip URL field entirely to avoid issues with JWT tokens
  // Google Calendar has strict requirements and long token URLs cause import failures
  // URLs are already included in DESCRIPTION (as base URLs if they contain tokens)
  
  // Determine reminder time based on rules:
  // - Online classes: 15 minutes before
  // - First class of day (offline): 30 minutes before
  // - Other classes: 15 minutes before
  let reminderMinutes = 15; // Default
  if (isOnline) {
    reminderMinutes = 15; // Online classes: always 15 minutes
  } else if (isFirstClassOfDay) {
    reminderMinutes = 30; // First class of day (offline): 30 minutes
  } else {
    reminderMinutes = 15; // Other classes: 15 minutes
  }
  
  // Add alarm/reminder
  lines.push('BEGIN:VALARM');
  lines.push(`TRIGGER:-PT${reminderMinutes}M`);
  lines.push('ACTION:DISPLAY');
  lines.push(`DESCRIPTION:Reminder: ${escapeIcsText(summary)}`);
  lines.push('END:VALARM');
  
  lines.push('END:VEVENT');
  
  // Return array of lines (will be folded in generateIcsFile)
  return lines;
}

/**
 * Generate complete ICS file content from classes array
 * @param {Array} classes - Array of class data objects
 * @returns {string} Complete ICS file content
 */
function generateIcsFile(classes) {
  if (!Array.isArray(classes) || classes.length === 0) {
    throw new Error('No classes to export');
  }
  
  // Sort classes by date and time
  const sortedClasses = [...classes].sort((a, b) => {
    const dateA = new Date(a.date + 'T' + a.time.start);
    const dateB = new Date(b.date + 'T' + b.time.start);
    return dateA - dateB;
  });
  
  // Group classes by date to determine first class of each day
  const classesByDate = {};
  sortedClasses.forEach(classData => {
    const dateKey = classData.date;
    if (!classesByDate[dateKey]) {
      classesByDate[dateKey] = [];
    }
    classesByDate[dateKey].push(classData);
  });
  
  // Sort classes within each day by start time
  Object.keys(classesByDate).forEach(dateKey => {
    classesByDate[dateKey].sort((a, b) => {
      const timeA = a.time.start;
      const timeB = b.time.start;
      return timeA.localeCompare(timeB);
    });
  });
  
  // Build ICS file
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FPTU Study Calendar//FPTU Study Calendar Exporter//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:FPTU Study Calendar`,
    `X-WR-CALDESC:Study schedule exported from FPTU FAP`,
    `X-WR-TIMEZONE:Asia/Ho_Chi_Minh`,
  ];
  
  // Add each event with information about whether it's the first class of the day
  sortedClasses.forEach((classData, index) => {
    // Check if this is the first class of the day
    // Compare by date and time to find the earliest class on this date
    const dateKey = classData.date;
    const dayClasses = classesByDate[dateKey];
    let isFirstClassOfDay = false;
    
    if (dayClasses && dayClasses.length > 0) {
      // The first class in the sorted array for this day is the earliest
      const firstClassOfDay = dayClasses[0];
      isFirstClassOfDay = (
        firstClassOfDay.date === classData.date &&
        firstClassOfDay.time.start === classData.time.start &&
        firstClassOfDay.activityId === classData.activityId
      );
    }
    
    const eventLines = generateIcsEvent(classData, index, isFirstClassOfDay);
    if (eventLines && Array.isArray(eventLines) && eventLines.length > 0) {
      lines.push(...eventLines);
    }
  });
  
  lines.push('END:VCALENDAR');
  
  // Fold all lines according to RFC 5545
  const foldedLines = lines.map(line => foldIcsLine(line));
  
  // Join with CRLF and ensure file ends with CRLF (RFC 5545 requirement)
  return foldedLines.join('\r\n') + '\r\n';
}

/**
 * Download ICS file
 * @param {string} icsContent - ICS file content
 * @param {string} filename - Filename (default: fptu-calendar.ics)
 */
function downloadIcsFile(icsContent, filename = 'fptu-calendar.ics') {
  // Create blob with proper MIME type
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  // Create download link
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  // Trigger download
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Export classes to ICS file
 * @param {Array} classes - Array of class data objects
 * @param {string} filename - Optional filename
 */
function exportToIcs(classes, filename) {
  try {
    if (!Array.isArray(classes) || classes.length === 0) {
      throw new Error('No classes to export');
    }
    
    // Generate ICS content
    const icsContent = generateIcsFile(classes);
    
    // Generate filename with date range if not provided
    if (!filename) {
      const dates = classes.map(c => c.date).sort();
      const startDate = dates[0] || new Date().toISOString().split('T')[0];
      const endDate = dates[dates.length - 1] || startDate;
      filename = `fptu-calendar-${startDate}-to-${endDate}.ics`;
    }
    
    // Download file
    downloadIcsFile(icsContent, filename);
    
    return true;
  } catch (error) {
    console.error('Error exporting to ICS:', error);
    throw error;
  }
}

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    exportToIcs,
    generateIcsFile,
    generateIcsEvent,
    formatIcsDateTime,
    escapeIcsText
  };
}

