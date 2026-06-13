---
"@contractsentry/core": minor
"@contractsentry/cli": patch
---

Add JavaScript file support and Express `.route()` chaining detection

`@contractsentry/core` now detects routes defined via Express-style `.route('/path').get(handler).post(handler)` chaining, including arbitrarily deep chains. The TypeScript/JavaScript analyzer already parsed `.js` files correctly; CLI help text has been updated to reflect this.
