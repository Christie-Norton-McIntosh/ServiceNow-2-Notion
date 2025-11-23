#!/bin/bash
curl -s -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "databaseId": "1544ecee-bba9-8002-e90a-b7d5f053af00",
  "title": "Test v11.0.71: Nested callout & table positioning",
  "contentHtml": "CONTENT_PLACEHOLDER",
  "url": "https://docs.servicenow.com/test"
}
EOF
