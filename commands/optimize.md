# /optimize Command

## Description
Analyzes existing code and suggests or applies performance, bundle size, and code quality optimizations.

## Usage
```
/optimize [optional: specific area to optimize]
```

## Examples
```
/optimize
/optimize the FlatList rendering performance
/optimize bundle size for the Next.js app
/optimize the Redux store
```

## What Gets Optimized

### Performance
- Unnecessary re-renders (missing React.memo, useMemo, useCallback)
- FlatList / VirtualizedList optimization (keyExtractor, getItemLayout, removeClippedSubviews)
- Image optimization (lazy loading, WebP, next/image)
- Code splitting and lazy imports
- Debouncing/throttling event handlers
- Avoiding heavy computations in render

### Bundle Size
- Tree shaking unused exports
- Dynamic imports for large components
- Analyzing bundle with `@next/bundle-analyzer` or `react-native-bundle-visualizer`
- Removing unused dependencies
- Replacing heavy libraries with lighter alternatives

### Code Quality
- Removing code duplication (extract custom hooks/utilities)
- Simplifying complex conditionals
- Proper TypeScript types (remove `any`)
- Consistent error handling
- Removing dead code

### Network
- API response caching
- Request deduplication
- Proper loading and error states
- Optimistic updates

## Output Format
```
⚡ Optimization Report

🔴 High Impact (fix immediately):
- [Issue] → [Solution] → Estimated improvement: X%

🟡 Medium Impact:
- [Issue] → [Solution]

🟢 Low Impact (nice to have):
- [Issue] → [Solution]
```
