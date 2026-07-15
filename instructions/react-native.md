# React Native Instructions

## Setup (Expo Managed Workflow — Recommended)
```bash
npx create-expo-app@latest MyApp --template blank-typescript
cd MyApp
npx expo install react-native-reanimated react-native-gesture-handler
npx expo install expo-router
```

## Key Packages
```json
{
  "dependencies": {
    "expo": "~51.0.0",
    "expo-router": "~3.5.0",
    "react-native-reanimated": "~3.10.0",
    "react-native-gesture-handler": "~2.16.0",
    "nativewind": "^4.0.0",
    "tailwindcss": "^3.4.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.5.0",
    "axios": "^1.6.0",
    "react-native-mmkv": "^2.12.0",
    "expo-secure-store": "~13.0.0",
    "expo-notifications": "~0.28.0",
    "@react-navigation/native": "^6.1.0",
    "@react-navigation/stack": "^6.3.0",
    "@react-navigation/bottom-tabs": "^6.5.0",
    "react-native-safe-area-context": "4.10.0",
    "react-native-screens": "~3.31.0",
    "react-hook-form": "^7.51.0",
    "zod": "^3.22.0"
  }
}
```

## NativeWind Setup (Tailwind for React Native)
```js
// tailwind.config.js
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
};
```

## Common Patterns

### Screen Template
```typescript
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1 px-4">
        <Text className="text-2xl font-bold mt-4">Home</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
```

### API Service
```typescript
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const api = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

## EAS Build Config (eas.json)
```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "staging": { "distribution": "internal", "env": { "APP_ENV": "staging" } },
    "production": { "distribution": "store" }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "your@apple.id", "ascAppId": "XXXXXXXX" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```
