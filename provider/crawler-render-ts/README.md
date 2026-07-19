# crawler-render-ts

TypeScript-native render adapter for crawler split architecture.

Responsibilities:

- receive render jobs from crawler-control / crawler-fetch escalation path
- map render options to Playwright or Browser Rendering compatible payloads
- return normalized HTML/title/final URL envelope

This package is adapter-first. The actual browser runtime can be wired later
to Cloudflare Browser Rendering or browserless.
