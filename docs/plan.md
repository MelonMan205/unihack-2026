# Plan

## WORKER

### Files

- urls.json
- .env
  - Gemini API key

### Subsystems

- URL scraper
- HTMLRewrite sanitiser
- Feed sanitised data into Gemini
  - Outputs JSON object
- Validate JSON
  - Reprompt if invalid
- Push parsed data to Supabase
