# Figma Integration

Workflows for using Figma with GhostForge projects.

---

## Design Token Sync (Style Dictionary)

### Setup
```bash
npm install -D style-dictionary
```

### Export tokens from Figma (Figma Tokens plugin)
```json
// tokens/tokens.json (exported from Figma Tokens plugin)
{
  "color": {
    "primary": { "50": { "value": "#f0f9ff" }, "500": { "value": "#0ea5e9" }, "900": { "value": "#0c4a6e" } },
    "ghostforge": { "blue": { "value": "#003087" }, "gold": { "value": "#FFD700" } }
  },
  "spacing": {
    "1": { "value": "4px" }, "2": { "value": "8px" }, "4": { "value": "16px" }
  },
  "typography": {
    "heading-xl": { "value": { "fontSize": "36px", "fontWeight": "700", "lineHeight": "1.2" } }
  }
}
```

### Style Dictionary Config
```javascript
// style-dictionary.config.js
module.exports = {
  source: ['tokens/**/*.json'],
  platforms: {
    // Tailwind CSS
    css: {
      transformGroup: 'css',
      buildPath: 'src/styles/',
      files: [{ destination: 'tokens.css', format: 'css/variables' }],
    },
    // React Native (NativeWind / Tamagui)
    js: {
      transformGroup: 'js',
      buildPath: 'src/tokens/',
      files: [{ destination: 'tokens.ts', format: 'javascript/es6' }],
    },
  },
};
```

### Run sync
```bash
npx style-dictionary build
```

---

## Figma MCP (Copilot Integration)
With Figma's MCP (Model Context Protocol) server, Copilot can read your Figma designs directly.

### Setup Figma MCP in VS Code
```json
// .vscode/mcp.json
{
  "servers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--figma-api-key", "${env:FIGMA_API_KEY}"]
    }
  }
}
```

### Usage
Once configured, you can paste a Figma URL in Copilot Chat:
```
Here's the Figma design: https://figma.com/design/xxx
Generate the React component for the ProductCard frame.
```

### Environment Variable
```bash
FIGMA_API_KEY=figd_xxxxxxxxxxxx  # From Figma → Settings → Personal access tokens
```
