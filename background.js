// Background service worker for LeetCode Code Saver extension
// Currently minimal, can be expanded for future features like:
// - Listening for messages from content script
// - Handling long-term storage
// - Managing extension lifecycle events

console.log('LeetCode Code Saver background service worker started');

// Example: Listen for messages from content script (if needed in future)
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.action === 'saveToGitHub') {
//     // Handle save request
//   }
// });

// Example: Handle extension installation/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('LeetCode Code Saver extension installed/updated');
});

// Example: Handle extension update
chrome.runtime.onUpdateAvailable.addListener(() => {
  console.log('Update available for LeetCode Code Saver extension');
});