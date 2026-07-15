# Add Feature Prompts

## Authentication
```
Add complete authentication to this project:
- Login screen/page (email + password)
- Register screen/page
- Forgot password + reset flow
- Token storage (SecureStore mobile / httpOnly cookie web)
- Access token + refresh token rotation
- Protected routes/screens
- Logout (clear all tokens)
- Auth provider: [JWT / Azure AD / NextAuth / Google]
Match existing code style and folder structure.
```

## Dark Mode
```
Add dark mode to this project:
- Toggle button in Settings/Profile
- Persist preference (AsyncStorage/localStorage)
- Apply to all existing screens/pages
- Match existing component patterns
- Support system preference (prefers-color-scheme)
```

## Push Notifications (Mobile)
```
Add push notifications:
- Request permission on app launch
- Register device token with backend
- Handle foreground notifications (show in-app banner)
- Handle background tap → navigate to relevant screen
- Notification types: [list your notification types]
- Provider: Expo Notifications + FCM
```

## Offline Support (Mobile)
```
Add offline support:
- Cache API responses with React Query
- Show offline banner when no connection
- Queue failed mutations for retry when back online
- Persist critical data with MMKV
- Graceful degradation — show cached data with "last updated" timestamp
```

## Search & Filters
```
Add search and filter functionality:
- Debounced search input (300ms)
- Filter panel with: [list your filters]
- Persist filters across navigation
- Show active filter count badge
- Clear all filters button
- API-side filtering (pass params to backend)
- Empty state for no results
```

## File Upload
```
Add file/image upload:
- Pick image from gallery or camera (mobile) / file input (web)
- Preview before upload
- Compress image before upload (react-native-image-manipulator / browser Canvas)
- Upload to: [Azure Blob Storage / S3 / your API]
- Show upload progress
- Handle errors with retry
```

## Internalization (i18n)
```
Add multi-language support:
- Languages: Arabic (RTL), English (LTR)
- Library: react-i18next (web) or i18n-js (mobile)
- RTL layout flip for Arabic
- Language switcher in Settings
- Persist language preference
- Translate all existing text strings
```
