# Optimization Prompts

## Performance Audit
```
Perform a full performance audit:
- Find unnecessary re-renders (missing React.memo, useMemo, useCallback)
- Find expensive computations in render functions
- Check FlatList/ScrollView optimization (mobile)
- Check image loading (lazy, WebP, next/image)
- Find missing code splitting (large components that should be lazy)
- Check bundle size (identify large dependencies)
- Check network requests (caching, deduplication, waterfall)
- Run Lighthouse (web) or RN Profiler (mobile)
Generate report with estimated improvement per fix.
```

## Bundle Size
```
Optimize bundle size:
- Analyze with webpack-bundle-analyzer or @next/bundle-analyzer
- Identify and remove unused dependencies
- Replace heavy libraries with lighter alternatives
- Implement dynamic imports for large components
- Check for duplicate packages in node_modules
- Enable tree shaking
- Optimize images and assets
Target: reduce bundle by X%
```

## React Native Performance
```
Optimize React Native app performance:
- Fix unnecessary re-renders with React.memo and useMemo
- Optimize FlatList (keyExtractor, getItemLayout, removeClippedSubviews, windowSize)
- Move expensive logic off JS thread (use Reanimated worklets)
- Reduce bridge crossings
- Use Hermes engine (if not already)
- Optimize image loading (FastImage, WebP)
- Reduce app startup time (lazy load heavy screens)
```

## Database Query Optimization
```
Optimize these slow database queries:
[paste queries here]

Check for:
- Missing indexes
- N+1 query problems
- Unnecessary SELECT * 
- Subqueries that can be JOINs
- Missing query result caching
Generate optimized versions with execution plan analysis.
```
