# /storybook Command

## Purpose
Generate a Storybook 7+ CSF3 `.stories.tsx` file for any React component.

## Usage
```bash
/storybook [ComponentName]
```

## What AI should do
1. Locate the requested component and its TypeScript props interface or type.
2. Infer the Storybook title from the folder structure.
3. Generate a CSF3 story file beside the component.
4. Create `argTypes` for all detected props.
5. Add these stories by default:
   - `Default`
   - `Loading`
   - `Error`
   - `Empty`
   - `RTL`
6. Add a `play` function for basic interaction testing when the component has clickable or form behavior.
7. Preserve project aliases, import style, and component conventions.

## Generated story requirements
- Storybook 7+ format using `Meta` and `StoryObj`
- `tags: ['autodocs']`
- Complete `argTypes` based on the TypeScript props
- Sensible default args
- RTL story using a `dir: 'rtl'` wrapper or Storybook parameter
- Loading, error, and empty states tailored to the component shape

## Example
```bash
/storybook UserTable
```

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import { UserTable } from './UserTable';

const meta = {
  title: 'Data Display/UserTable',
  component: UserTable,
  tags: ['autodocs']
} satisfies Meta<typeof UserTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: {} };
```
