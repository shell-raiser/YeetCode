# LeetCode Code Saver

A browser extension that allows you to save your LeetCode code and notes directly to a GitHub repository with a single click.

## Features

- **One-click saving**: Save your current code and notes to GitHub with a custom button next to LeetCode's submit button
- **GitHub Integration**: Securely store your solutions using your GitHub Personal Access Token
- **Stable Per-Problem Files**: Each problem is saved in a root-level folder named after the question
- **Configurable Repository**: Set your GitHub repository and branch in extension options
- **Git History Friendly**: Repeated saves update the same code and notes files, with submission time in the commit message
- **Status Feedback**: Visual feedback on save status (success/error messages)

## Installation

### For Development / Testing

1. Clone or download this repository
2. Open Chrome Browser
3. Navigate to `chrome://extensions/`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked"
6. Select the directory containing this extension's files
7. The extension should now be loaded and visible in your extensions

### Usage

1. Navigate to any LeetCode problem page (e.g., https://leetcode.com/problems/two-sum/)
2. Click the extension icon to open options (or go through Chrome extensions menu)
3. Configure your GitHub settings:
   - **GitHub Personal Access Token**: Generate one at https://github.com/settings/tokens (needs `repo` scope)
   - **GitHub Repository**: In format `owner/repo` (e.g., `username/leetcode-solutions`)
   - **Branch**: Default is `main` (change if you use a different branch)
4. Click "Save Settings"
5. On the LeetCode problem page, you'll see a new "Save to GitHub" button next to the submit button
6. Write your code/notes in the editor
7. Click "Save to GitHub" to save your current work
8. Check your GitHub repository for files like `two-sum/two-sum.py` and `two-sum/two-sum-notes.md`

## Architecture

The extension consists of four main components:

1. **manifest.json** - Defines the extension's metadata, permissions, and content scripts
2. **options.html/options.js** - Popup page for configuring GitHub settings
3. **contentScript.js** - Main logic that runs on LeetCode pages:
   - Adds the custom "Save to GitHub" button
   - Retrieves code from LeetCode's editor
   - Gets problem information (title, URL, timestamp)
   - Fetches saved GitHub settings
   - Saves code to GitHub via GitHub API
4. **background.js** - Service worker (currently minimal, can be expanded for future features)

### How It Works

1. When you navigate to a LeetCode problem page, the content script waits for the page to load
2. It observes the DOM for the submit button and editor to be available
3. Once found, it injects a "Save to GitHub" button next to the submit button
4. Clicking the button triggers:
   - Code extraction from LeetCode's editor (Monaco editor or fallback methods)
   - Problem information gathering (title from URL/page, timestamp)
   - Retrieval of GitHub settings from Chrome storage
   - GitHub API calls to create/update the code and notes files in your specified repository
   - File naming: `{problem-title}/{problem-title}.{ext}` and `{problem-title}/{problem-title}-notes.md`
   - Commit message: `Save LeetCode solution: {problem-title} ({timestamp})`
5. Success/error messages are displayed temporarily near the button

## GitHub Personal Access Token

To use this extension, you need to generate a GitHub Personal Access Token:

1. Go to https://github.com/settings/personal-access-tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name (e.g., "LeetCode Code Saver")
4. Set expiration (recommended: no expiration or 6 months)
5. Select the `repo` scope (full control of private repositories)
6. Click "Generate token"
7. Copy the token (you won't be able to see it again)
8. Paste it into the extension's options page

> **Security Note**: The token is stored securely in Chrome's sync storage and is only used for GitHub API calls from your browser. It is never transmitted to any third-party server.

## File Structure

```
leetcode-code-saver/
├── manifest.json
├── options.html
├── options.js
├── contentScript.js
├── pageBridge.js
├── background.js
└── README.md
```

## Future Enhancements

- [x] Support for saving notes separately from code
- [ ] Option to include problem description in saved files
- [ ] Ability to save multiple files per problem (different approaches)
- [ ] Integration with GitHub Gists as an alternative
- [ ] Support for other code editors (if LeetCode changes theirs)
- [x] Auto-save functionality
- [x] Language detection and appropriate file extensions
- [ ] Option to create pull requests instead of direct commits
- [ ] Support for Firefox and other browsers

## Troubleshooting

### Button Not Appearing
- Make sure you're on a LeetCode problem page (URL starts with `https://leetcode.com/problems/`)
- Try refreshing the page
- Check if the extension is enabled in `chrome://extensions/`
- Open DevTools (F12) and check the console for errors

### Saving Fails
- Verify your GitHub token is correctly entered in options
- Check that your token has the `repo` scope
- Ensure you have access to the specified repository
- Check that the repository name is in correct format (`owner/repo`)
- Look at the error message displayed for specific GitHub API errors
- Check DevTools console for detailed error information

### Extension Not Working After Update
- Try removing and re-adding the extension in `chrome://extensions/`
- Clear your browser cache for the extension

## License

MIT

## Acknowledgments

- Inspired by the need to better track LeetCode progress
- Uses Chrome Extension APIs
- Integrates with GitHub REST API v3
