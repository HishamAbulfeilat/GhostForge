# Azure Integration Instructions

## Azure Static Web Apps (Next.js Deployment)

### GitHub Actions Workflow
```yaml
name: Deploy to Azure Static Web Apps
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: upload
          app_location: "/"
          output_location: ".next"
```

## Azure DevOps Pipeline
```yaml
trigger:
  branches:
    include: [main, develop]

pool:
  vmImage: 'ubuntu-latest'

stages:
- stage: Build
  jobs:
  - job: BuildAndTest
    steps:
    - task: NodeTool@0
      inputs: { versionSpec: '20.x' }
    - script: npm ci
    - script: npm run lint
    - script: npm test -- --coverage
    - script: npm run build
    - task: PublishBuildArtifacts@1

- stage: Deploy_Staging
  dependsOn: Build
  jobs:
  - deployment: DeployStaging
    environment: staging
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureStaticWebApp@0
            inputs:
              app_location: '/'
              azure_static_web_apps_api_token: $(AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING)

- stage: Deploy_Production
  dependsOn: Deploy_Staging
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
  jobs:
  - deployment: DeployProduction
    environment: production
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureStaticWebApp@0
            inputs:
              azure_static_web_apps_api_token: $(AZURE_STATIC_WEB_APPS_API_TOKEN_PROD)
```

## Azure Key Vault Integration
```typescript
// In Next.js API route
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const credential = new DefaultAzureCredential();
const client = new SecretClient(`https://${process.env.KEY_VAULT_NAME}.vault.azure.net`, credential);

export async function getSecret(name: string) {
  const secret = await client.getSecret(name);
  return secret.value;
}
```
