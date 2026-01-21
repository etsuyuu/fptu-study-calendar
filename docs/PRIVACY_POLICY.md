# Privacy Policy for FPTU Study Calendar

**Last Updated:** 2025-12-21

## Introduction

FPTU Study Calendar ("we," "our," or "the extension") is a Chrome browser extension that helps FPT University students export their class schedules from the FAP (FPT Academic Portal) website to calendar applications. This privacy policy explains how we handle your data when you use our extension.

## Data Collection

### What Data We Collect

The extension collects and processes the following types of data:

1. **Class Schedule Data**: When you use the extension to extract your schedule, we collect:
   - Subject codes and course information
   - Class dates and times
   - Class locations (physical or online)
   - Google Meet URLs (if applicable)
   - EduNext URLs (if applicable)
   - FLM (FPT Learning Materials) URLs (if applicable)
   - Class status (attended, absent, not yet)
   - Activity IDs from FAP

2. **User Preferences**: 
   - Theme preference (light, dark, or system)
   - Wait time settings for page operations
   - Date range selections (start and end dates)

3. **Temporary Session Data**:
   - Login state cache (temporary, expires after 30 minutes)
   - Scraping progress flags (stored in browser session storage, cleared when scraping completes)

### How We Collect Data

- **Directly from FAP Website**: The extension extracts schedule data directly from the FPT University FAP website (https://fap.fpt.edu.vn) when you are logged in and actively use the extraction feature.
- **User Input**: Preferences and settings are collected when you configure the extension through the popup interface.
- **Browser Storage**: The extension uses Chrome's local storage API to save your preferences and extracted schedule data.

## Data Storage

### Local Storage Only

**All data is stored exclusively on your device** using Chrome's `chrome.storage.local` API. We do not operate any external servers, and no data is transmitted to third-party servers or services.

### Data Retention

- **Schedule Data**: Stored locally until you extract a new schedule (which replaces the old data) or until browser startup (when it is automatically cleared).
- **User Preferences**: Stored locally and persist until you change them or uninstall the extension.
- **Login State Cache**: Automatically expires after 30 minutes and is cleared on browser startup.
- **Session Data**: Temporary flags stored in browser session storage are automatically cleared when scraping completes or when you close the browser tab.

### Data Deletion

You can delete all stored data at any time by:
- Uninstalling the extension (this removes all stored data)
- Manually clearing Chrome's extension storage through browser developer tools
- Extracting a new schedule (this replaces previous schedule data)

## Data Usage

### How We Use Your Data

The extension uses collected data solely for the following purposes:

1. **Schedule Extraction**: To extract and display your class schedule from the FAP website
2. **Calendar Export**: To generate ICS (iCalendar) files for import into calendar applications
3. **Calendar Preview**: To display your schedule in a visual calendar format within the extension
4. **User Preferences**: To remember your theme and settings preferences for a better user experience

### What We Do NOT Do

- We do **not** send any data to external servers
- We do **not** share your data with third parties
- We do **not** use your data for advertising or marketing
- We do **not** track your browsing behavior outside of the FAP website
- We do **not** collect personal information beyond what is necessary for the extension to function

## Data Sharing

**We do not share, sell, or transmit your data to any third parties.** All data remains on your device and is only used by the extension itself.

## Permissions

The extension requires the following permissions:

- **`activeTab`**: To interact with the FAP website when you click the extension icon
- **`scripting`**: To inject content scripts that extract schedule data from the FAP website
- **`storage`**: To save your schedule data and preferences locally on your device
- **`tabs`**: To manage browser tabs during the schedule extraction process
- **Host Permission (`https://fap.fpt.edu.vn/*`)**: To access and extract data from the FPT University FAP website

These permissions are necessary for the extension to function and are used only for the purposes described in this privacy policy.

## Security

We take data security seriously:

- All data is stored locally on your device using Chrome's secure storage APIs
- No data is transmitted over the internet
- The extension only accesses the FAP website when you explicitly initiate the extraction process
- Login state is cached temporarily (30 minutes) and automatically cleared on browser startup

However, please note that:
- You are responsible for maintaining the security of your FAP account credentials
- The extension does not store or have access to your FAP login credentials
- You must be logged into FAP separately in your browser for the extension to work

## Third-Party Services

The extension interacts with the following third-party services:

1. **FPT University FAP Website** (https://fap.fpt.edu.vn): The extension extracts data from this website. Your use of FAP is subject to FPT University's terms of service and privacy policy.

2. **Google Meet** (if applicable): If your classes include Google Meet links, these are extracted and included in exported calendar files. The extension does not interact with Google Meet directly.

3. **EduNext** (if applicable): If your classes include EduNext links, these are extracted and included in exported calendar files. The extension does not interact with EduNext directly.

4. **FLM (FPT Learning Materials)** (if applicable): If your classes include FLM links, these are extracted and included in exported calendar files. The extension does not interact with FLM directly.

The extension does not send any data to these services. It only extracts publicly visible information from the FAP website when you are logged in.

## Children's Privacy

This extension is intended for use by FPT University students. If you are under the age of 18, please ensure you have parental consent before using this extension. We do not knowingly collect personal information from children without parental consent.

## Your Rights

You have the following rights regarding your data:

- **Access**: You can view all stored data through the extension's calendar preview feature
- **Deletion**: You can delete all stored data by uninstalling the extension or extracting a new schedule
- **Control**: You can control what data is stored by choosing when to extract schedules and what date ranges to include
- **Portability**: You can export your schedule data as an ICS file at any time

## Changes to This Privacy Policy

We may update this privacy policy from time to time. We will notify you of any material changes by:
- Updating the "Last Updated" date at the top of this policy
- Including a notice in the extension's update notes (if distributed through Chrome Web Store)

Your continued use of the extension after any changes constitutes acceptance of the updated privacy policy.

## Contact Information

If you have any questions, concerns, or requests regarding this privacy policy or how we handle your data, please contact us through:

- **GitHub Issues**: https://github.com/etsuyuu/fptu-study-calendar/issues
- **Email**: buidungnd.2005@gmail.com

## Disclaimer

This extension is not officially affiliated with FPT University. It is a community project created to help students manage their schedules more efficiently. The extension is provided "as is" without any warranties.

## Compliance

This privacy policy is designed to comply with:
- Chrome Web Store Developer Program Policies
- General data protection principles
- User privacy expectations

---

**Note**: This extension operates entirely locally on your device. No data leaves your computer except when you explicitly export it (e.g., downloading an ICS file). We believe in privacy by design and have built the extension with this principle in mind.

