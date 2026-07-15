# /storybook Command

## Description
Generates Storybook stories for React components, sets up Storybook from scratch, or documents an entire component library.

## Usage
```
/storybook setup                    → Install and configure Storybook
/storybook generate [component]     → Generate stories for a component
/storybook generate --all           → Generate stories for all components
```

## Setup
```bash
npx storybook@latest init
npm install -D @storybook/addon-a11y @storybook/addon-interactions
```

## Generated Story
```typescript
// components/ui/Button/Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger', 'ghost'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: 'Click me', variant: 'primary' },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
};

export const LoadingState: Story = {
  args: { children: 'Saving...', disabled: true, isLoading: true },
};
```
