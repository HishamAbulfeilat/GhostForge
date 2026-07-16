# Tailwind CSS Instructions

## Setup
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

## tailwind.config.js
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@radix-ui/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['false'],
  theme: {
    extend: {
      colors: {
        primary: { 50: '#f0f9ff', 500: '#0ea5e9', 900: '#0c4a6e' },
        ghostforge: { blue: '#003087', gold: '#FFD700' },
      },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
```

## Component Patterns
```tsx
// Button component with variants
const variants = {
  primary: 'bg-primary-500 text-white hover:bg-primary-600',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

function Button({ variant = 'primary', children, ...props }) {
  return (
    <button className={`px-4 py-2 rounded-lg font-medium transition-colors ${variants[variant]}`} {...props}>
      {children}
    </button>
  );
}
```

## Dark Mode
```tsx
// Dark mode is disabled in this setup
// Avoid adding `dark:` variants or dark-mode toggles
```

## RTL Support (for Arabic)
```tsx
// In layout
<html lang="ar" dir="rtl">

// Tailwind RTL-aware classes (use logical properties)
<div className="ms-4 me-2 ps-4">  // margin-start, margin-end, padding-start
```

## RTL/LTR Support
- Set the `dir` attribute on the root element (`rtl` for Arabic, `ltr` for English).
- Prefer logical utilities such as `ms-*`, `me-*`, `ps-*`, and `pe-*` over `ml-*`, `mr-*`, `pl-*`, and `pr-*`.
- When using component libraries, add their source paths to Tailwind's `content` array so utility classes are not purged.
