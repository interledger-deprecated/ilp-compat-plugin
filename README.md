# ilp-plugin-compat

> ILP plugin compatibility layer

Turns any LPI1 plugin into an LPI2 plugin.

## Usage

``` js
const compat = require('ilp-compat-plugin')

const Plugin = require('some-old-plugin')

const plugin = compat(new Plugin({ ... }))

console.log(plugin.constructor.version) // => 2

// Use LPI2
const { fulfillment, data } = await plugin.sendTransfer({ ... })

```

Note that it's safe to pass LPI2 plugins to compat, it will simply become a no-op.
