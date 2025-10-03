<!-- Short PR template to ensure builds and manual validation are performed before merging -->

## Summary

Describe the change in one or two sentences.

## Checklist (required)

- [ ] I ran `npm run build` locally and the build completed without errors.
- [ ] I opened `dist/ServiceNow-2-Notion.user.js` in Tampermonkey and performed a basic smoke test (main panel loads, key modals open on demand).
- [ ] I searched the codebase for `w2n-` ids if I changed UI element names.
- [ ] New/changed UI components follow `injectFoo()` + `setupFoo()` pattern.
- [ ] I updated the package version in `package.json` (semantic bump) and included the new version in the PR title. Example: `npm version patch` or `npm version minor`.

## Test plan

Describe manual steps taken (pages visited, buttons clicked) and expected results.

## Notes

Anything the reviewer should look for (external services, config toggles, known limitations).
