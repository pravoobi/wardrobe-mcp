# Demo video — shot by shot (< 3 min)

Lead with the customer, not the architecture. 1080p, English VO, no music, no third-party logos.

| Time | Shot | VO / on-screen |
|---|---|---|
| 0:00–0:20 | The voice flow, live. Echo Show (or simulator). | "Alexa, I have a sangeet on Saturday. What should I wear? Budget eight thousand." Alexa+ reads 3 options. |
| 0:20–1:40 | The full sangeet loop on screen. | "Show me the magenta one on me." → rendered try-on appears. "Save that. Now the navy one." → "Compare them." → side-by-side. "Go with the magenta." → confirmation + purchase link. |
| 1:40–2:20 | One diagram: the renderer bridge. | "The try-on pipeline is browser-only. We don't port it — the server drives the try-on app's *own* WebMCP tools through headless Chromium. One tool contract, two transports. Rendering is pre-computed; every tool call is a sub-500ms cache read." |
| 2:20–2:50 | AWS + open source. | App Runner, S3/CloudFront, DynamoDB, Bedrock. New MIT repo created during the window. What's new vs. the pre-existing try-on app. |
| 2:50–3:00 | Close. | The thesis line: "Alexa+ is the stylist's voice; this is the stylist's memory and eyes." |
