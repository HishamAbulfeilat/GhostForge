# /explain

Explain runtime errors, log snippets, or piped stack traces with AI-assisted fixes.

## Usage
```bash
bash scripts/explain.sh error "TypeError: Cannot read properties of undefined"
bash scripts/explain.sh log logs/app.log
cat logs/app.log | bash scripts/explain.sh pipe
bash scripts/explain.sh last
```
