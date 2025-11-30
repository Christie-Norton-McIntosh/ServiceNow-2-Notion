# Icon Detection Feature (v11.1.0)

## Overview
ServiceNow-2-Notion now automatically detects yes/no/check/cross icons in tables and converts them to emojis in Notion.

## What's Changed
Previously, all images in table cells were either:
- Extracted as separate image blocks after the table (for large images with captions)
- Replaced with bullet placeholders (•) for uncaptioned images

Now, small icons representing yes/no/check/cross are intelligently detected and replaced with appropriate emojis:
- **YES/CHECK/AVAILABLE** → ✅ (white check mark)
- **NO/CROSS/UNAVAILABLE** → ❌ (cross mark)

## Detection Logic

The icon detector uses multiple patterns to identify common icons and replace them with appropriate emojis:

### 1. Pattern Matching Priority
The system checks patterns in this order:
1. **Filename/URL patterns** (highest priority)
2. **Alt text patterns** (if filename doesn't match)
3. **Size heuristic** (if no pattern matches)

### 2. Supported Icon Types

**Status Indicators:**
- ✅ **YES/CHECK/AVAILABLE**: yes, check, tick, available, enabled, true, success, valid, active, confirmed, approved
- ❌ **NO/CROSS/UNAVAILABLE**: no, cross, unavailable, disabled, false, error, invalid, inactive, denied, rejected

**Alerts & Information:**
- ⚠️ **WARNING/CAUTION**: warning, caution, alert, attention, important
- ℹ️ **INFO/NOTE**: info, information, note, notice, fyi
- 💡 **TIP/HINT**: tip, hint, suggestion, lightbulb, idea, best practice
- ❓ **HELP/QUESTION**: help, question, support, assistance

**Security:**
- 🔒 **LOCK/SECURE**: lock, locked, security, secure, protected, private, encrypted
- 🔓 **UNLOCK/OPEN**: unlock, unlocked, open, public, unprotected

**Actions:**
- ⚙️ **SETTINGS**: settings, config, configuration, gear, preferences, options
- ✏️ **EDIT**: edit, pencil, modify, change, update
- 🗑️ **DELETE**: delete, trash, remove, discard, bin
- 🔍 **SEARCH**: search, find, lookup, magnifying glass
- ⬇️ **DOWNLOAD**: download, down arrow, save
- ⬆️ **UPLOAD**: upload, up arrow

**Objects:**
- 🔗 **LINK**: link, chain, url, hyperlink, connection
- 👤 **USER**: user, person, profile, account, individual
- 👥 **GROUP**: group, people, team, users, members
- ⭐ **STAR**: star, favorite, bookmark, featured
- 🚩 **FLAG**: flag, marker, marked
- 📅 **CALENDAR**: calendar, date, schedule, appointment
- ⏰ **CLOCK**: clock, time, timer, hour, minute
- 📄 **FILE**: file, document, doc, page, paper
- 📁 **FOLDER**: folder, directory, dir
- 📧 **EMAIL**: email, mail, message, envelope
- 📞 **PHONE**: phone, telephone, call, mobile
- 🏠 **HOME**: home, house, main, dashboard

### 3. Image Size Heuristic
Small images (≤32px width or height) without specific pattern matches default to ✅ (positive/yes).
- Typical icon sizes: 16x16, 24x24, 32x32 pixels
- Large images (>32px) use bullet placeholder (•)

## Examples

### Before (v11.0.x)
```
| Feature    | Supported |
|------------|-----------|
| OAuth 2.0  | •         |
| SAML       | •         |
```

### After (v11.1.0)
```
| Feature    | Supported |
|------------|-----------|
| OAuth 2.0  | ✅        |
| SAML       | ❌        |
```

## Technical Implementation

**File**: `server/converters/table.cjs`
**Function**: `processTableCellContent()`
**Lines**: ~192-238

The logic executes before generic image placeholder replacement:

1. Extract alt text, src, width, and height from `<img>` tags
2. Check against yes/no patterns (alt text and filename)
3. Check if image is small icon (≤32px)
4. Replace with appropriate emoji or bullet placeholder

## Debug Logging

When icons are detected, the converter logs:
```
✨ Detected YES/CHECK icon (alt="yes", src="yes.png", 16x16px) → replacing with ✅
✨ Detected NO/CROSS icon (alt="no", src="no.png", 16x16px) → replacing with ❌
```

## Testing

A comprehensive test suite is available:
```bash
node server/tests/test-icon-detection.cjs
```

Tests cover:
- Alt text pattern matching (yes/no)
- Filename pattern matching (check/cross)
- Small icon auto-detection
- Large image fallback to bullet

## Future Enhancements

Potential additions for future versions:
- Additional icon types (warning ⚠️, info ℹ️, etc.)
- Custom emoji mappings via config
- Size threshold configuration
- Pattern customization via `.env`

## Impact on Validation

This feature should reduce false positives in validation tests where icon images were counted as "missing images" when they were actually intentionally converted to text representations.
