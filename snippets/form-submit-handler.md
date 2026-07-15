# form-submit-handler

## Purpose
Typed async submit handler with loading and error state.

## Code
```ts
import { useState } from 'react';

export function useSubmitHandler<T>(submit: (values: T) => Promise<void>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: T) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await submit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, error, handleSubmit };
}
```
