# rn-safe-area

## Purpose
React Native safe area wrapper with keyboard avoiding behavior.

## Code
```tsx
import { KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function ScreenContainer({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```
