# /deploy Command

## Description
Generates deployment scripts, pipelines, and instructions to deploy to various targets.

## Usage
```
/deploy [optional: target environment or platform]
```

## Examples
```
/deploy
/deploy to Azure Static Web Apps
/deploy React Native app to App Store and Play Store
/deploy to staging first, then production
/deploy with Docker to Azure App Service
```

## Deployment Options

### Web (Next.js / React)
1. **Azure Static Web Apps** (recommended for Next.js)
   - GitHub Actions workflow
   - Staging and production slots
   - Custom domain + SSL
   
2. **Azure App Service** (for SSR / API routes)
   - Docker container deployment
   - Deployment slots (staging/production)
   
3. **Vercel** (alternative)
   - Zero-config Next.js deployment

### Mobile (React Native)
1. **EAS Build + EAS Submit**
   - iOS → TestFlight → App Store
   - Android → Internal Testing → Play Store
   
2. **EAS Update** (OTA)
   - Push JS bundle updates without app store review
   
3. **GitHub Actions + EAS**
   - Auto-build on main branch push

### CI/CD Pipeline Includes
- Install dependencies
- Run linting
- Run tests
- Build
- Deploy to staging
- Run smoke tests
- Deploy to production (manual approval gate)
- Notify team (Slack/Teams)

## Rollback Strategy
Every deployment pipeline includes:
- Keep last 3 deployment slots
- One-click rollback command
- Health check verification after deployment
