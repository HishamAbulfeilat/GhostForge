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
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
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
// Toggle dark mode
document.documentElement.classList.toggle('dark');

// Use in components
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
```

## RTL Support (for Arabic)
```tsx
// In layout
<html lang="ar" dir="rtl">

// Tailwind RTL-aware classes (use logical properties)
<div className="ms-4 me-2 ps-4">  // margin-start, margin-end, padding-start
```
