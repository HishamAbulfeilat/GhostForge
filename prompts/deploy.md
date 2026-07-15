# Deployment Prompts

## Azure Static Web Apps (Next.js)
```
Generate a complete deployment setup for Next.js to Azure Static Web Apps:
- GitHub Actions workflow (lint → test → build → deploy staging → deploy production)
- Environment variables setup (staging vs production)
- Custom domain configuration
- Staging slot for preview deployments on PRs
- Rollback instructions
- Post-deploy smoke test
```

## Azure App Service (Node.js API)
```
Generate deployment for Node.js API to Azure App Service:
- Docker containerization (Dockerfile + .dockerignore)
- GitHub Actions: build → push to ACR → deploy to App Service
- Environment variables from Azure Key Vault
- Deployment slots (staging → production swap)
- Health check endpoint
- Application Insights setup
```

## React Native (EAS)
```
Generate EAS Build + Submit pipeline:
- eas.json with dev, staging, production profiles
- GitHub Actions: build iOS + Android on push to main
- EAS Submit to TestFlight (iOS) and Play Store Internal (Android)
- EAS Update for OTA hotfixes
- Environment variables per profile
- Versioning strategy (auto-increment build number)
```

## Azure DevOps Pipeline
```
Generate Azure DevOps pipeline YAML for:
- Project type: [Next.js / Node.js API / React Native]
- Stages: Build → Test → Deploy Staging → Approval Gate → Deploy Production
- Variable groups for secrets
- Email notification on failure
- Rollback on failed deployment
- Integration with Azure Key Vault
```

## Full Stack Deployment
```
Generate complete deployment for full stack app:
- Frontend: Next.js → Azure Static Web Apps
- Backend: NestJS → Azure App Service (Docker)
- Database: PostgreSQL → Azure Database for PostgreSQL
- Secrets: Azure Key Vault
- CI/CD: GitHub Actions (separate workflows per app)
- Monitoring: Application Insights
- Zero-downtime deployment strategy
```
